import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------
let userQueryResults: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(userQueryResults);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		update: () => chainable()
	}
}));

const mockCreditService = {
	hasTransaction: vi.fn().mockResolvedValue(false),
	allocateMonthlyCredits: vi.fn(),
	allocateEquipmentCredits: vi.fn(),
	setBalance: vi.fn()
};
vi.mock('./credit-service', () => mockCreditService);

const mockEmit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: mockEmit }
}));

vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	cancelAllForUser: vi.fn()
}));

const mockBuildMemberSubscriptionState = vi.fn();
vi.mock('./subscription-service', () => ({
	buildMemberSubscriptionState: (...args: unknown[]) => mockBuildMemberSubscriptionState(...args)
}));

const mockGetStripeProductId = vi.fn().mockResolvedValue('prod_fee');
vi.mock('./product-config-service', () => ({
	getStripeProductId: (...args: unknown[]) => mockGetStripeProductId(...args)
}));

const {
	handleCheckoutCompleted,
	handleInvoicePaid,
	handleSubscriptionUpdated,
	handleSubscriptionDeleted,
	handleInvoicePaymentFailed,
	handleChargeRefunded
} = await import('./webhook-handlers');
const { registeredEvents } = await import('./webhook-events');

// ---------------------------------------------------------------------------
// handleCheckoutCompleted
// ---------------------------------------------------------------------------
describe('handleCheckoutCompleted', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('emits checkout.completed domain event with session data', async () => {
		const session = {
			id: 'cs_123',
			metadata: { reservation_id: 'res-42' }
		} as unknown as Stripe.Checkout.Session;
		await handleCheckoutCompleted(session);

		expect(mockEmit).toHaveBeenCalledWith('checkout.completed', {
			sessionId: 'cs_123',
			metadata: { reservation_id: 'res-42' },
			stripeSession: session
		});
	});

	it('defaults metadata to empty object when null', async () => {
		const session = { id: 'cs_no_meta', metadata: null } as unknown as Stripe.Checkout.Session;
		await handleCheckoutCompleted(session);

		expect(mockEmit).toHaveBeenCalledWith('checkout.completed', {
			sessionId: 'cs_no_meta',
			metadata: {},
			stripeSession: session
		});
	});
});

// ---------------------------------------------------------------------------
// handleInvoicePaid
// ---------------------------------------------------------------------------
describe('handleInvoicePaid', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('allocates monthly credits based on subscription quantity', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(5);

		const invoice = {
			id: 'inv_123',
			parent: {
				subscription_details: { subscription: 'sub_abc' }
			},
			customer: 'cus_123',
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_abc' } },
						quantity: 5,
						amount: 2500
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		// Credits granted = quantity × 2 (each $5-unit = 1 hour = 2 thirty-min credits).
		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith('user-1', 10, 'inv_123');
	});

	it('handles customer as an object with id property', async () => {
		userQueryResults = [{ id: 'user-2' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(3);

		const invoice = {
			id: 'inv_obj_cus',
			parent: {
				subscription_details: { subscription: { id: 'sub_obj' } }
			},
			customer: { id: 'cus_456' },
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_obj' } },
						quantity: 3,
						amount: 1500
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-2',
			6,
			'inv_obj_cus'
		);
	});

	it('skips non-subscription invoices', async () => {
		const invoice = {
			id: 'inv_one_time',
			parent: { subscription_details: null },
			customer: 'cus_123'
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
	});

	it('skips lines without subscription_item_details', async () => {
		userQueryResults = [{ id: 'user-1' }];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const invoice = {
			id: 'inv_proration',
			parent: {
				subscription_details: { subscription: 'sub_abc' }
			},
			customer: 'cus_123',
			lines: {
				data: [{ parent: { subscription_item_details: null }, quantity: 1, amount: 100 }]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('allocates from the contribution line even when the fee line comes first', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(24);

		// Stripe does not guarantee line ordering — the fee-coverage line also
		// matches "subscription line with quantity > 0" and must not be picked.
		const invoice = {
			id: 'inv_fee_first',
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123',
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_fee' } },
						pricing: { price_details: { product: 'prod_fee' } },
						quantity: 1,
						amount: 209
					},
					{
						parent: { subscription_item_details: { subscription_item: 'si_contrib' } },
						pricing: { price_details: { product: 'prod_contrib' } },
						quantity: 12,
						amount: 6000
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		// 6000¢ / 250 = 24 credits — NOT round(209/250) = 1 from the fee line.
		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-1',
			24,
			'inv_fee_first'
		);
		expect(mockCreditService.allocateEquipmentCredits).toHaveBeenCalledWith(
			'user-1',
			6000,
			'inv_fee_first'
		);
	});

	it('ignores proration lines when picking the contribution line', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(10);

		const invoice = {
			id: 'inv_prorated',
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123',
			lines: {
				data: [
					{
						// Mid-cycle upgrade proration — larger amount, must be skipped.
						parent: {
							subscription_item_details: { subscription_item: 'si_contrib', proration: true }
						},
						pricing: { price_details: { product: 'prod_contrib' } },
						quantity: 14,
						amount: 7000
					},
					{
						parent: {
							subscription_item_details: { subscription_item: 'si_contrib', proration: false }
						},
						pricing: { price_details: { product: 'prod_contrib' } },
						quantity: 5,
						amount: 2500
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-1',
			10,
			'inv_prorated'
		);
	});

	it('falls back to the largest-amount line when the fee product id is unresolvable', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockGetStripeProductId.mockRejectedValueOnce(new Error('KV unavailable'));
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(24);

		const invoice = {
			id: 'inv_fee_unknown',
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123',
			lines: {
				data: [
					{
						parent: { subscription_item_details: { subscription_item: 'si_fee' } },
						quantity: 1,
						amount: 209
					},
					{
						parent: { subscription_item_details: { subscription_item: 'si_contrib' } },
						quantity: 12,
						amount: 6000
					}
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		// The fee (~3% + 30¢) is always smaller than the contribution it covers.
		expect(mockCreditService.allocateMonthlyCredits).toHaveBeenCalledWith(
			'user-1',
			24,
			'inv_fee_unknown'
		);
	});

	it('warns when no user found for customer', async () => {
		userQueryResults = [];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const invoice = {
			id: 'inv_orphan',
			parent: {
				subscription_details: { subscription: 'sub_xyz' }
			},
			customer: 'cus_unknown',
			lines: {
				data: [
					{ parent: { subscription_item_details: { subscription_item: 'si_xyz' } }, quantity: 3 }
				]
			}
		} as unknown as Stripe.Invoice;

		await handleInvoicePaid(invoice);

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no user found'));
		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// handleSubscriptionDeleted
// ---------------------------------------------------------------------------
describe('handleSubscriptionDeleted', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('resets free_hours balance to 0', async () => {
		userQueryResults = [{ id: 'user-1' }];
		mockCreditService.setBalance.mockResolvedValue(0);

		const subscription = {
			id: 'sub_cancelled',
			customer: 'cus_123'
		} as unknown as Stripe.Subscription;

		await handleSubscriptionDeleted(subscription);

		expect(mockCreditService.setBalance).toHaveBeenCalledWith(
			'user-1',
			'free_hours',
			0,
			'monthly_allocation',
			'sub_cancelled',
			expect.any(String)
		);
	});

	it('warns when no user found for customer', async () => {
		userQueryResults = [];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const subscription = {
			id: 'sub_orphan',
			customer: 'cus_ghost'
		} as unknown as Stripe.Subscription;

		await handleSubscriptionDeleted(subscription);

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no user found'));
		expect(mockCreditService.setBalance).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------
// This file used to mock `./webhook-events` with a hand-written copy of the
// array, which had already drifted — it was missing
// `customer.subscription.updated`. The real module is imported instead, so the
// registry has one definition and this asserts against it.
describe('registeredEvents', () => {
	it('subscribes the events a failed or refunded payment arrives on', () => {
		// Without invoice.payment_failed a member's card fails, credits stop, and
		// nobody is told. Without charge.refunded a dashboard refund never
		// reaches the local record.
		expect(registeredEvents).toContain('invoice.payment_failed');
		expect(registeredEvents).toContain('charge.refunded');
	});

	it('has a handler for every event it subscribes', async () => {
		const { webhookHandlerMap } = await import('./webhook-handlers');
		for (const event of registeredEvents) {
			expect(typeof webhookHandlerMap[event]).toBe('function');
		}
	});
});

// ---------------------------------------------------------------------------
// Membership domain events
// ---------------------------------------------------------------------------

/** A paid contribution invoice with one subscription line. */
function contributionInvoice(overrides: Record<string, unknown> = {}) {
	return {
		id: 'inv_m1',
		billing_reason: 'subscription_cycle',
		amount_paid: 2500,
		hosted_invoice_url: 'https://stripe.test/inv_m1',
		parent: { subscription_details: { subscription: 'sub_abc' } },
		customer: 'cus_123',
		lines: {
			data: [
				{
					parent: { subscription_item_details: { subscription_item: 'si_abc' } },
					quantity: 5,
					amount: 2500,
					period: { end: 1893456000 }
				}
			]
		},
		...overrides
	} as unknown as Stripe.Invoice;
}

describe('membership payment events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }];
		mockCreditService.allocateMonthlyCredits.mockResolvedValue(10);
	});

	it('emits membership.started on the first invoice of a subscription', async () => {
		await handleInvoicePaid(contributionInvoice({ billing_reason: 'subscription_create' }));

		expect(mockEmit).toHaveBeenCalledWith(
			'membership.started',
			expect.objectContaining({
				userId: 'user-1',
				userName: 'Ada',
				userEmail: 'ada@example.com',
				amountCents: 2500,
				invoiceId: 'inv_m1'
			})
		);
	});

	it('emits membership.renewed on a later cycle', async () => {
		await handleInvoicePaid(contributionInvoice());

		const events = mockEmit.mock.calls.map(([name]) => name);
		expect(events).toContain('membership.renewed');
		expect(events).not.toContain('membership.started');
	});

	it('reads first-vs-renewal from billing_reason, not from the absent snapshot', async () => {
		// A member who lapsed and came back has a null `user.subscription`, so
		// inferring "first payment" from that would mail them the wrong email.
		// Their invoice still says subscription_cycle.
		userQueryResults = [
			{ id: 'user-1', name: 'Ada', email: 'ada@example.com', subscription: null }
		];

		await handleInvoicePaid(contributionInvoice({ billing_reason: 'subscription_cycle' }));

		const events = mockEmit.mock.calls.map(([name]) => name);
		expect(events).toContain('membership.renewed');
		expect(events).not.toContain('membership.started');
	});

	it('carries the billing period and the hours the contribution buys', async () => {
		await handleInvoicePaid(contributionInvoice());

		const [, payload] = mockEmit.mock.calls.find(([n]) => n === 'membership.renewed')!;
		expect(payload).toMatchObject({
			// quantity 5 → 10 credits → 5 hours. The bus carries hours.
			freeHoursPerMonth: 5,
			periodEnd: new Date(1893456000 * 1000).toISOString(),
			coveringFees: false
		});
	});

	it('emits nothing when the Stripe customer matches no local user', async () => {
		userQueryResults = [];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await handleInvoicePaid(contributionInvoice());

		expect(mockEmit).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe('handleInvoicePaymentFailed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }];
	});

	it('emits membership.payment_failed with the retry date and pay link', async () => {
		await handleInvoicePaymentFailed({
			id: 'inv_fail',
			amount_due: 2500,
			hosted_invoice_url: 'https://stripe.test/pay',
			next_payment_attempt: 1893456000,
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123'
		} as unknown as Stripe.Invoice);

		expect(mockEmit).toHaveBeenCalledWith('membership.payment_failed', {
			userId: 'user-1',
			userName: 'Ada',
			userEmail: 'ada@example.com',
			amountCents: 2500,
			invoiceId: 'inv_fail',
			hostedInvoiceUrl: 'https://stripe.test/pay',
			nextAttemptAt: new Date(1893456000 * 1000).toISOString()
		});
	});

	it('leaves credits alone — Stripe retries, and a first decline is not a lapse', async () => {
		await handleInvoicePaymentFailed({
			id: 'inv_fail',
			amount_due: 2500,
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123'
		} as unknown as Stripe.Invoice);

		expect(mockCreditService.setBalance).not.toHaveBeenCalled();
		expect(mockCreditService.allocateMonthlyCredits).not.toHaveBeenCalled();
	});

	it('nulls nextAttemptAt when Stripe has given up retrying', async () => {
		await handleInvoicePaymentFailed({
			id: 'inv_fail',
			amount_due: 2500,
			parent: { subscription_details: { subscription: 'sub_abc' } },
			customer: 'cus_123'
		} as unknown as Stripe.Invoice);

		const [, payload] = mockEmit.mock.calls[0];
		expect(payload).toMatchObject({ nextAttemptAt: null, hostedInvoiceUrl: null });
	});

	it('ignores a one-off invoice that is not a subscription', async () => {
		await handleInvoicePaymentFailed({
			id: 'inv_oneoff',
			parent: { subscription_details: null },
			customer: 'cus_123'
		} as unknown as Stripe.Invoice);

		expect(mockEmit).not.toHaveBeenCalled();
	});
});

describe('handleSubscriptionUpdated', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const activeSub = {
		id: 'sub_abc',
		status: 'active',
		customer: 'cus_123',
		metadata: {}
	} as unknown as Stripe.Subscription;

	it('emits cancellation_scheduled when cancelAtPeriodEnd flips false to true', async () => {
		userQueryResults = [
			{
				id: 'user-1',
				name: 'Ada',
				email: 'ada@example.com',
				subscription: { cancelAtPeriodEnd: false }
			}
		];
		mockBuildMemberSubscriptionState.mockResolvedValue({
			cancelAtPeriodEnd: true,
			creditsResetAt: '2027-01-01T00:00:00.000Z'
		});

		await handleSubscriptionUpdated(activeSub);

		expect(mockEmit).toHaveBeenCalledWith('membership.cancellation_scheduled', {
			userId: 'user-1',
			userName: 'Ada',
			userEmail: 'ada@example.com',
			endsAt: '2027-01-01T00:00:00.000Z'
		});
	});

	it('stays quiet when the cancellation was already scheduled', async () => {
		// Stripe re-sends `updated` for reasons of its own. Keying on the state
		// rather than the transition would mail the member on every one.
		userQueryResults = [
			{
				id: 'user-1',
				name: 'Ada',
				email: 'ada@example.com',
				subscription: { cancelAtPeriodEnd: true }
			}
		];
		mockBuildMemberSubscriptionState.mockResolvedValue({
			cancelAtPeriodEnd: true,
			creditsResetAt: '2027-01-01T00:00:00.000Z'
		});

		await handleSubscriptionUpdated(activeSub);

		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('stays quiet on an ordinary update', async () => {
		userQueryResults = [
			{
				id: 'user-1',
				name: 'Ada',
				email: 'ada@example.com',
				subscription: { cancelAtPeriodEnd: false }
			}
		];
		mockBuildMemberSubscriptionState.mockResolvedValue({ cancelAtPeriodEnd: false });

		await handleSubscriptionUpdated(activeSub);

		expect(mockEmit).not.toHaveBeenCalled();
	});
});

describe('handleChargeRefunded', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userQueryResults = [];
	});

	it('ignores a charge with no payment intent to match on', async () => {
		await expect(
			handleChargeRefunded({ id: 'ch_1', payment_intent: null } as unknown as Stripe.Charge)
		).resolves.toBeUndefined();
	});

	it('accepts a payment intent given as an object', async () => {
		await expect(
			handleChargeRefunded({
				id: 'ch_2',
				payment_intent: { id: 'pi_123' }
			} as unknown as Stripe.Charge)
		).resolves.toBeUndefined();
	});

	it('sends no email — a refund is a record correction, not news', async () => {
		await handleChargeRefunded({
			id: 'ch_3',
			payment_intent: 'pi_123'
		} as unknown as Stripe.Charge);

		expect(mockEmit).not.toHaveBeenCalled();
	});
});
