import type Stripe from 'stripe';

/**
 * The slice of the Stripe SDK this application actually calls.
 *
 * Every member is `Pick`ed off Stripe's own resource types, so the compiler is
 * the contract: a fake cannot drift into a shape the live API would reject.
 * `webhooks` is absent on purpose — verifying a signature needs no API call, so
 * it stays on the real SDK whichever driver is live (`$lib/server/stripe`).
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
	/**
	 * What actually hit the platform balance, which is what the weekly
	 * reconciliation compares the ledger against (#1183). A charge total would
	 * not do: a Connect destination charge reports in full while only its
	 * application fee is ever the collective's.
	 */
	readonly balanceTransactions: Pick<Stripe['balanceTransactions'], 'list'>;
	readonly checkout: {
		sessions: Pick<Stripe['checkout']['sessions'], 'create' | 'retrieve' | 'list'>;
	};
	readonly coupons: Pick<Stripe['coupons'], 'create' | 'del'>;
	readonly customers: Pick<Stripe['customers'], 'create' | 'update'>;
	readonly invoices: Pick<Stripe['invoices'], 'list'>;
	readonly paymentIntents: Pick<Stripe['paymentIntents'], 'retrieve' | 'create' | 'cancel'>;
	readonly paymentMethods: Pick<Stripe['paymentMethods'], 'list' | 'detach' | 'update'>;
	readonly paymentRecords: Pick<
		Stripe['paymentRecords'],
		'reportPayment' | 'reportRefund' | 'retrieve'
	>;
	readonly prices: Pick<Stripe['prices'], 'retrieve'>;
	readonly products: Pick<Stripe['products'], 'list' | 'create' | 'update'>;
	readonly refunds: Pick<Stripe['refunds'], 'create'>;
	readonly setupIntents: Pick<Stripe['setupIntents'], 'create' | 'retrieve'>;
	readonly subscriptions: Pick<Stripe['subscriptions'], 'list' | 'update' | 'retrieve'>;
	/**
	 * Tap to Pay at the door (#612). The phone is the reader, bound to a Location
	 * at connect time, so there is nothing to register: a token scoped to the
	 * Location, and the Location itself to confirm it exists.
	 */
	readonly terminal: {
		connectionTokens: Pick<Stripe['terminal']['connectionTokens'], 'create'>;
		locations: Pick<Stripe['terminal']['locations'], 'retrieve'>;
	};
}

/**
 * Which implementation backs `stripe`. Resolved from `PAYMENTS_DRIVER`, and
 * `fake` unless the environment explicitly asks for `stripe` — the default is
 * deliberately the safe one, because a developer `.env` in this project has
 * historically held a live key.
 */
export type PaymentDriver = 'stripe' | 'fake';
