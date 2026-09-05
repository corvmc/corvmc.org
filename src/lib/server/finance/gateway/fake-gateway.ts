import type Stripe from 'stripe';
import type { PaymentGateway } from './types';
import {
	fakeCharge,
	fakeCheckoutSession,
	fakeCoupon,
	fakeCustomer,
	fakeId,
	fakeInvoice,
	fakePaymentIntent,
	fakePaymentMethod,
	fakePaymentRecord,
	fakePrice,
	fakeProduct,
	fakeRefund,
	fakeSetupIntent,
	fakeSubscription,
	nowSeconds
} from './fixtures';

/**
 * An in-memory stand-in for Stripe.
 *
 * It exists because Stripe's own guidance rules out the alternative: the
 * Payment Element and Checkout "have security measures in place that prevent
 * automated testing", and the recommendation is to return simulated objects
 * rather than call Stripe.js and the API from a test suite
 * (https://docs.stripe.com/automated-testing). `stripe-mock` does not help
 * either — it is stateless by design, so a session created on one request is
 * not there to be retrieved on the next, which is exactly what every flow here
 * depends on.
 *
 * State lives for the life of the worker isolate, which is what makes an
 * end-to-end run possible: create a session on one request, complete it on
 * another, read the fulfilled row on a third.
 */

// ---------------------------------------------------------------------------
// Stripe response plumbing
// ---------------------------------------------------------------------------

function respond<T>(body: T): Stripe.Response<T> {
	return {
		...body,
		lastResponse: { headers: {}, requestId: fakeId('req'), statusCode: 200 }
	};
}

function listOf<T>(data: T[]): Stripe.ApiListPromise<T> {
	const promise = Promise.resolve(
		respond<Stripe.ApiList<T>>({ object: 'list', data, has_more: false, url: '' })
	);
	let cursor = 0;
	const extras = {
		next: async (): Promise<IteratorResult<T>> =>
			cursor < data.length
				? { value: data[cursor++], done: false }
				: { value: undefined as unknown as T, done: true },
		[Symbol.asyncIterator]() {
			return this as AsyncIterableIterator<T>;
		},
		autoPagingEach: async (handler: (item: T) => boolean | void | Promise<boolean | void>) => {
			for (const item of data) {
				if ((await handler(item)) === false) break;
			}
		},
		autoPagingToArray: async () => [...data]
	};
	return Object.assign(promise, extras) as unknown as Stripe.ApiListPromise<T>;
}

/** Stripe rejects unknown ids with a 404-shaped error; mirror that, not `undefined`. */
function notFound(resource: string, id: string): never {
	const err = new Error(`No such ${resource}: '${id}'`);
	err.name = 'StripeInvalidRequestError';
	throw err;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface FakeStore {
	sessions: Map<string, Stripe.Checkout.Session>;
	/** Line items are not part of the session object unless expanded; kept aside for completion. */
	sessionIntentMetadata: Map<string, Stripe.MetadataParam>;
	paymentIntents: Map<string, Stripe.PaymentIntent>;
	paymentRecords: Map<string, Stripe.PaymentRecord>;
	subscriptions: Map<string, Stripe.Subscription>;
	invoices: Map<string, Stripe.Invoice>;
	customers: Map<string, Stripe.Customer>;
	products: Map<string, Stripe.Product>;
	prices: Map<string, Stripe.Price>;
	coupons: Map<string, Stripe.Coupon>;
	accounts: Map<string, Stripe.Account>;
	paymentMethods: Map<string, Stripe.PaymentMethod>;
	setupIntents: Map<string, Stripe.SetupIntent>;
}

const store: FakeStore = {
	sessions: new Map(),
	sessionIntentMetadata: new Map(),
	paymentIntents: new Map(),
	paymentRecords: new Map(),
	subscriptions: new Map(),
	invoices: new Map(),
	customers: new Map(),
	products: new Map(),
	prices: new Map(),
	coupons: new Map(),
	accounts: new Map(),
	paymentMethods: new Map(),
	setupIntents: new Map()
};

/** Customers whose seeded card and history have already been materialised. */
const seeded = new Set<string>();

/** Drop all state. For specs — an e2e run relies on state surviving between requests. */
export function resetFakeGateway(): void {
	for (const map of Object.values(store)) map.clear();
	seeded.clear();
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function lineItemAmount(item: Stripe.Checkout.SessionCreateParams.LineItem): number {
	const quantity = item.quantity ?? 1;
	if (item.price_data?.unit_amount != null) return item.price_data.unit_amount * quantity;
	if (item.price) {
		const price = store.prices.get(item.price);
		return (price?.unit_amount ?? 0) * quantity;
	}
	return 0;
}

function discountAmount(discounts: Stripe.Checkout.SessionCreateParams.Discount[] = []): number {
	return discounts.reduce((sum, discount) => {
		const coupon = discount.coupon ? store.coupons.get(discount.coupon) : undefined;
		return sum + (coupon?.amount_off ?? 0);
	}, 0);
}

/**
 * Where the fake sends the customer instead of `checkout.stripe.com`. The origin
 * is lifted from whichever return URL the caller supplied, so the fake follows
 * the app around ports and preview hosts without configuration of its own.
 *
 * It is the same `/checkout/<session>` route an `elements` session uses: that
 * page decides from the live driver whether to mount a Payment Element or the
 * fake's card-number form, so a hosted-mode fake and a real Elements session
 * land in the same place.
 */
function fakeCheckoutUrl(params: Stripe.Checkout.SessionCreateParams, sessionId: string): string {
	const reference = params.success_url ?? params.return_url ?? params.cancel_url;
	const origin = reference ? new URL(reference).origin : '';
	return `${origin}/checkout/${sessionId}`;
}

// ---------------------------------------------------------------------------
// Seeded customers
// ---------------------------------------------------------------------------

/**
 * A `cus_seed_…` customer has a card and a billing history; it just does not
 * exist in Stripe.
 *
 * The dev seed writes those ids onto its sustaining-member personas
 * (`scripts/seed/sustaining-personas.ts`). Everything Stripe holds about them —
 * the card on file, the invoices — lives in Stripe rather than in D1, so
 * without this the surfaces that replaced the billing portal render empty for
 * every seeded member and nobody can look at the feature they just built.
 *
 * Materialised into the store on first read rather than returned from a
 * synthesizer, so the rest of the flow works on it for real: the card can be
 * detached, the subscription can be pointed at another one.
 *
 * Deliberately keyed on the seed's own `cus_seed_` prefix, and deliberately not
 * on anything an e2e fixture uses — a spec that means to start with no card
 * says so by choosing a customer id outside this prefix.
 */
function materialiseSeedCustomer(customerId: string | undefined): void {
	if (!customerId?.startsWith('cus_seed')) return;
	if (seeded.has(customerId)) return;
	seeded.add(customerId);

	const card = fakePaymentMethod({
		id: `pm_seed_${customerId.slice(-8)}`,
		customer: customerId,
		card: {
			brand: 'visa',
			last4: '4242',
			exp_month: 8,
			exp_year: new Date().getUTCFullYear() + 3
		} as Stripe.PaymentMethod.Card
	});
	store.paymentMethods.set(card.id, card);

	const subscriptionId = `sub_seed_${customerId.slice(-8)}`;
	if (!store.subscriptions.has(subscriptionId)) {
		store.subscriptions.set(
			subscriptionId,
			fakeSubscription({
				id: subscriptionId,
				customer: customerId,
				default_payment_method: card.id
			})
		);
	}

	// Six months back, on the same day each month, at a steady $25 — the shape a
	// contribution actually has, so the history reads like one rather than like
	// six rows of noise.
	const month = 30 * 24 * 60 * 60;
	for (let ago = 0; ago < 6; ago++) {
		const id = `in_seed_${customerId.slice(-8)}_${ago}`;
		store.invoices.set(
			id,
			fakeInvoice({
				id,
				customer: customerId,
				subscription: subscriptionId,
				created: nowSeconds() - ago * month,
				amount_paid: 2500,
				total: 2500,
				status: 'paid',
				hosted_invoice_url: `https://invoice.fake.test/${id}`,
				invoice_pdf: `https://invoice.fake.test/${id}.pdf`
			} as Partial<Stripe.Invoice>)
		);
	}
}

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

export function createFakeGateway(): PaymentGateway {
	return {
		/**
		 * Connect, standing in far enough for a band to be "onboarded" locally.
		 *
		 * `charges_enabled` and `payouts_enabled` come back true immediately,
		 * because the thing they gate — whether a record can be sold — is what the
		 * seed and the e2e suite need to be able to reach. The real Express flow
		 * takes a human through Stripe's hosted onboarding and can sit
		 * `restricted` for days; nothing on this side can stand in for that, so
		 * the onboarding link is a URL that goes nowhere and is never followed.
		 */
		accounts: {
			create: async (params) => {
				const account = {
					id: fakeId('acct'),
					object: 'account',
					created: nowSeconds(),
					type: params?.type ?? 'express',
					business_type: params?.business_type ?? null,
					charges_enabled: true,
					payouts_enabled: true,
					details_submitted: true,
					email: params?.email ?? null,
					metadata: (params?.metadata as Record<string, string>) ?? {}
				} as Stripe.Account;
				store.accounts.set(account.id, account);
				return respond(account);
			},
			retrieve: (async (id?: string) => {
				const account = typeof id === 'string' ? store.accounts.get(id) : undefined;
				if (!account) throw new Error(`No such account: ${id}`);
				return respond(account);
			}) as PaymentGateway['accounts']['retrieve'],
			createLoginLink: (async (id: string) =>
				respond({
					object: 'login_link',
					created: nowSeconds(),
					url: `https://connect.fake.test/express/${id}`
				} as Stripe.LoginLink)) as PaymentGateway['accounts']['createLoginLink']
		},

		accountLinks: {
			create: async (params) =>
				respond({
					object: 'account_link',
					created: nowSeconds(),
					expires_at: nowSeconds() + 300,
					url: params?.refresh_url ?? 'https://connect.fake.test/onboarding'
				} as Stripe.AccountLink)
		},

		checkout: {
			sessions: {
				create: async (params) => {
					const lineItems = params?.line_items ?? [];
					const subtotal = lineItems.reduce((sum, item) => sum + lineItemAmount(item), 0);
					const discount = discountAmount(params?.discounts ?? undefined);
					const id = fakeId('cs');
					const session = fakeCheckoutSession({
						id,
						mode: params?.mode ?? 'payment',
						ui_mode: params?.ui_mode ?? 'hosted_page',
						amount_subtotal: subtotal,
						amount_total: Math.max(0, subtotal - discount),
						metadata: (params?.metadata as Record<string, string>) ?? {},
						customer: (params?.customer as string) ?? null,
						customer_email: params?.customer_email ?? null,
						success_url: params?.success_url ?? null,
						cancel_url: params?.cancel_url ?? null,
						return_url: params?.return_url ?? undefined,
						client_secret: `${id}_secret_fake`,
						url: fakeCheckoutUrl(params ?? {}, id)
					});
					store.sessions.set(id, session);
					if (params?.payment_intent_data?.metadata) {
						store.sessionIntentMetadata.set(id, params.payment_intent_data.metadata);
					}
					return respond(session);
				},

				retrieve: async (id) => {
					const session = store.sessions.get(id);
					return session ? respond(session) : notFound('checkout session', id);
				},

				list: (params) => {
					const all = [...store.sessions.values()];
					const paymentIntent = params?.payment_intent;
					const matched = paymentIntent
						? all.filter((s) => s.payment_intent === paymentIntent)
						: all;
					return listOf(matched.slice(0, params?.limit ?? matched.length));
				}
			}
		},

		coupons: {
			create: async (params) => {
				const coupon = fakeCoupon({
					amount_off: params?.amount_off ?? null,
					currency: params?.currency ?? null,
					max_redemptions: params?.max_redemptions ?? null,
					name: params?.name ?? null
				});
				store.coupons.set(coupon.id, coupon);
				return respond(coupon);
			},
			del: async (id) => {
				store.coupons.delete(id);
				return respond({ id, object: 'coupon', deleted: true } as Stripe.DeletedCoupon);
			}
		},

		customers: {
			create: async (params) => {
				const customer = fakeCustomer({
					email: params?.email ?? null,
					name: params?.name ?? null,
					metadata: (params?.metadata as Record<string, string>) ?? {}
				});
				store.customers.set(customer.id, customer);
				return respond(customer);
			}
		},

		invoices: {
			list: (params) => {
				materialiseSeedCustomer(params?.customer as string | undefined);
				const matched = [...store.invoices.values()].filter(
					(invoice) =>
						(!params?.customer || invoice.customer === params.customer) &&
						(!params?.status || invoice.status === params.status)
				);
				return listOf(matched);
			}
		},

		paymentIntents: {
			retrieve: async (id: string) => {
				const intent = store.paymentIntents.get(id);
				return intent ? respond(intent) : notFound('payment_intent', id);
			}
		},

		paymentMethods: {
			list: (params) => {
				materialiseSeedCustomer(params?.customer);
				return listOf(
					[...store.paymentMethods.values()].filter(
						(pm) =>
							(!params?.customer || pm.customer === params.customer) &&
							(!params?.type || pm.type === params.type)
					)
				);
			},
			detach: (async (id: string) => {
				const method = store.paymentMethods.get(id);
				if (!method) notFound('payment method', id);
				// Stripe returns the method with `customer` cleared rather than
				// deleting it, and a second detach of the same id is an error — so
				// the row stays, unattached.
				const detached = { ...method, customer: null };
				store.paymentMethods.set(id, detached);
				return respond(detached);
			}) as PaymentGateway['paymentMethods']['detach']
		},

		paymentRecords: {
			reportPayment: async (params) => {
				const record = fakePaymentRecord({
					amount: {
						value: params?.amount_requested?.value ?? 0,
						currency: params?.amount_requested?.currency ?? 'usd'
					} as Stripe.PaymentRecord.Amount,
					metadata: (params?.metadata as Record<string, string>) ?? {}
				});
				store.paymentRecords.set(record.id, record);
				return respond(record);
			},
			reportRefund: async (id) => {
				const record = store.paymentRecords.get(id);
				if (!record) return notFound('payment_record', id);
				const refunded = {
					...record,
					amount_refunded: record.amount
				} as Stripe.PaymentRecord;
				store.paymentRecords.set(id, refunded);
				return respond(refunded);
			},
			retrieve: async (id: string) => {
				const record = store.paymentRecords.get(id);
				return record ? respond(record) : notFound('payment_record', id);
			}
		},

		prices: {
			retrieve: async (id: string) => {
				const price = store.prices.get(id) ?? fakePrice({ id });
				store.prices.set(price.id, price);
				return respond(price);
			}
		},

		products: {
			list: (params) => {
				const matched = [...store.products.values()].filter(
					(product) => params?.active === undefined || product.active === params.active
				);
				return listOf(matched);
			},
			create: async (params) => {
				const product = fakeProduct({
					name: params?.name ?? 'Fake product',
					description: params?.description ?? null,
					metadata: (params?.metadata as Record<string, string>) ?? {}
				});
				store.products.set(product.id, product);
				return respond(product);
			},
			update: async (id, params) => {
				const existing = store.products.get(id) ?? fakeProduct({ id });
				const updated: Stripe.Product = {
					...existing,
					...(params?.name !== undefined && { name: params.name }),
					...(params?.description !== undefined && { description: params.description ?? null }),
					updated: nowSeconds()
				};
				store.products.set(id, updated);
				return respond(updated);
			}
		},

		refunds: {
			create: async (params) => {
				const intentId =
					typeof params?.payment_intent === 'string' ? params.payment_intent : undefined;
				const intent = intentId ? store.paymentIntents.get(intentId) : undefined;
				const amount = params?.amount ?? intent?.amount ?? 0;
				if (intent && intentId) {
					const charge =
						typeof intent.latest_charge === 'object' && intent.latest_charge
							? intent.latest_charge
							: fakeCharge({ amount, amount_captured: amount });
					store.paymentIntents.set(intentId, {
						...intent,
						latest_charge: { ...charge, amount_refunded: amount }
					});
				}
				return respond(fakeRefund({ amount, payment_intent: intentId ?? null }));
			}
		},

		setupIntents: {
			create: async (params) => {
				const intent = fakeSetupIntent({
					customer: (params?.customer as string) ?? null,
					usage: params?.usage ?? 'off_session',
					metadata: (params?.metadata as Record<string, string>) ?? {}
				});
				store.setupIntents.set(intent.id, intent);
				return respond(intent);
			},
			retrieve: (async (id?: string) => {
				const intent = typeof id === 'string' ? store.setupIntents.get(id) : undefined;
				if (!intent) notFound('setup intent', String(id));
				return respond(intent);
			}) as PaymentGateway['setupIntents']['retrieve']
		},

		subscriptions: {
			list: (params) => {
				materialiseSeedCustomer(params?.customer);
				const matched = [...store.subscriptions.values()].filter(
					(subscription) =>
						(!params?.customer || subscription.customer === params.customer) &&
						(!params?.status || params.status === 'all' || subscription.status === params.status)
				);
				return listOf(matched.slice(0, params?.limit ?? matched.length));
			},
			retrieve: async (id: string) => {
				const subscription = store.subscriptions.get(id);
				return subscription ? respond(subscription) : notFound('subscription', id);
			},
			update: async (id, params) => {
				const existing = store.subscriptions.get(id) ?? fakeSubscription({ id });
				const updated: Stripe.Subscription = {
					...existing,
					...(params?.cancel_at_period_end !== undefined && {
						cancel_at_period_end: params.cancel_at_period_end
					}),
					...(params?.metadata && {
						metadata: { ...existing.metadata, ...(params.metadata as Record<string, string>) }
					})
				};
				store.subscriptions.set(id, updated);
				return respond(updated);
			}
		}
	};
}

// ---------------------------------------------------------------------------
// Driving the fake from the fake checkout page
// ---------------------------------------------------------------------------

/**
 * Stripe's own test card numbers, so a test reads the same whichever driver is
 * behind it and a card that declines here declines against the real API too.
 */
export const FAKE_CARDS = {
	'4242424242424242': 'succeed',
	'4000000000000002': 'decline',
	'4000000000009995': 'insufficient_funds'
} as const;

export type FakeCardOutcome = (typeof FAKE_CARDS)[keyof typeof FAKE_CARDS];

export function outcomeForCard(cardNumber: string): FakeCardOutcome | undefined {
	return FAKE_CARDS[cardNumber.replace(/\s+/g, '') as keyof typeof FAKE_CARDS];
}

export function getFakeSession(sessionId: string): Stripe.Checkout.Session | undefined {
	return store.sessions.get(sessionId);
}

/**
 * Complete a fake session the way Stripe would, and return the session the
 * webhook translation layer expects. The caller is responsible for handing it
 * to `handleCheckoutCompleted` — the fake deliberately does not reach into the
 * domain bus itself, so the production path stays the only path to fulfillment.
 */
/**
 * Attach a card to a customer the way confirming a SetupIntent would.
 *
 * The real flow is `stripe.confirmSetup()` in the browser against the intent's
 * client secret, which the fake has no way to receive — so the fake's own
 * card-number form posts here instead. The card number picks the brand and last
 * four so a spec can assert on something it chose, and a declining test card
 * fails the way the live one does rather than attaching anyway.
 */
export function completeFakeSetupIntent(
	setupIntentId: string,
	cardNumber: string
): Stripe.PaymentMethod {
	const intent = store.setupIntents.get(setupIntentId);
	if (!intent) notFound('setup intent', setupIntentId);

	const digits = cardNumber.replace(/\s+/g, '');
	const method = fakePaymentMethod({
		// A SetupIntent's `customer` can expand to a deleted customer; a
		// PaymentMethod's cannot. The fake never expands, so this is always the id.
		customer: typeof intent.customer === 'string' ? intent.customer : null,
		card: {
			brand: digits.startsWith('5') ? 'mastercard' : 'visa',
			last4: digits.slice(-4),
			exp_month: 12,
			exp_year: new Date().getUTCFullYear() + 2
		} as Stripe.PaymentMethod.Card
	});
	store.paymentMethods.set(method.id, method);
	store.setupIntents.set(setupIntentId, {
		...intent,
		status: 'succeeded',
		payment_method: method.id
	});

	return method;
}

export function getFakeSetupIntent(id: string): Stripe.SetupIntent | undefined {
	return store.setupIntents.get(id);
}

export function completeFakeCheckout(sessionId: string): Stripe.Checkout.Session {
	const session = store.sessions.get(sessionId);
	if (!session) notFound('checkout session', sessionId);

	const completed: Stripe.Checkout.Session = {
		...session,
		status: 'complete',
		payment_status: session.amount_total === 0 ? 'no_payment_required' : 'paid'
	};

	if (session.mode === 'payment') {
		const amount = session.amount_total ?? 0;
		const intent = fakePaymentIntent({
			amount,
			metadata: (store.sessionIntentMetadata.get(sessionId) as Record<string, string>) ?? {},
			latest_charge: fakeCharge({ amount, amount_captured: amount })
		});
		store.paymentIntents.set(intent.id, intent);
		completed.payment_intent = intent.id;
	}

	if (session.mode === 'subscription') {
		const subscription = fakeSubscription({
			customer: session.customer ?? undefined,
			metadata: session.metadata ?? {}
		});
		store.subscriptions.set(subscription.id, subscription);
		completed.subscription = subscription.id;

		const invoice = fakeInvoice({
			customer: session.customer,
			total: session.amount_total ?? 0,
			metadata: { fake_subscription: subscription.id }
		});
		store.invoices.set(invoice.id, invoice);
	}

	store.sessions.set(sessionId, completed);
	return completed;
}
