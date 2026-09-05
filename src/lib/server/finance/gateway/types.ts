import type Stripe from 'stripe';

/**
 * The slice of the Stripe SDK this application actually calls.
 *
 * Every member is `Pick`ed off Stripe's own resource types, so an implementation
 * has to match Stripe's real signatures — the compiler is the contract, and a
 * fake cannot drift into a shape the live API would reject. It also means
 * reaching for a Stripe method the app has never used is a type error until it
 * is added here deliberately, which keeps the surface a fake has to cover
 * enumerable rather than open-ended.
 *
 * `webhooks` is absent on purpose: signature verification is a pure function of
 * the payload and the secret, so it stays on the real SDK regardless of driver
 * (see `stripeWebhooks` and `webhookCryptoProvider` in `$lib/server/stripe`).
 */
export interface PaymentGateway {
	/**
	 * Stripe Connect, for band payouts on record sales. A destination charge
	 * pays a connected account directly, so CMC never holds a band's banking
	 * details — which is also why there is no fake worth writing for the
	 * onboarding half: an Express account link is a URL into Stripe's own
	 * hosted flow, and there is nothing on this side to stand in for it.
	 */
	readonly accounts: Pick<Stripe['accounts'], 'create' | 'retrieve' | 'createLoginLink'>;
	readonly accountLinks: Pick<Stripe['accountLinks'], 'create'>;
	readonly checkout: {
		sessions: Pick<Stripe['checkout']['sessions'], 'create' | 'retrieve' | 'list'>;
	};
	readonly coupons: Pick<Stripe['coupons'], 'create' | 'del'>;
	readonly customers: Pick<Stripe['customers'], 'create'>;
	readonly invoices: Pick<Stripe['invoices'], 'list'>;
	readonly paymentIntents: Pick<Stripe['paymentIntents'], 'retrieve'>;
	readonly paymentMethods: Pick<Stripe['paymentMethods'], 'list' | 'detach'>;
	readonly paymentRecords: Pick<
		Stripe['paymentRecords'],
		'reportPayment' | 'reportRefund' | 'retrieve'
	>;
	readonly prices: Pick<Stripe['prices'], 'retrieve'>;
	readonly products: Pick<Stripe['products'], 'list' | 'create' | 'update'>;
	readonly refunds: Pick<Stripe['refunds'], 'create'>;
	readonly setupIntents: Pick<Stripe['setupIntents'], 'create' | 'retrieve'>;
	readonly subscriptions: Pick<Stripe['subscriptions'], 'list' | 'update' | 'retrieve'>;
}

/**
 * Which implementation backs `stripe`. Resolved from `PAYMENTS_DRIVER`, and
 * `fake` unless the environment explicitly asks for `stripe` — the default is
 * deliberately the safe one, because a developer `.env` in this project has
 * historically held a live key.
 */
export type PaymentDriver = 'stripe' | 'fake';
