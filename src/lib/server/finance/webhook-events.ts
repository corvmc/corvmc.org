/**
 * Webhook event registry — the single source of truth for which Stripe events
 * the application handles. This file has no side-effect imports, so it can be
 * used both by the SvelteKit webhook route and by standalone scripts (e.g.
 * scripts/sync-webhooks.ts).
 */

export const registeredEvents = [
	'checkout.session.completed',
	'invoice.paid',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	// A failed contribution is the one billing event a member has to act on, and
	// until this was subscribed their card could fail, credits stop, and nobody
	// — member or staff — be told.
	'invoice.payment_failed',
	// A refund issued from the Stripe dashboard never reached the app, so the
	// local payment row stood as if the money had stayed.
	'charge.refunded'
] as const;

export type RegisteredEvent = (typeof registeredEvents)[number];
