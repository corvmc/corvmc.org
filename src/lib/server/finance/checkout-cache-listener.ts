import { db } from '$lib/server/db';
import { paymentCache } from '$lib/server/db/schema/finance';
import { captureException } from '$lib/server/sentry';
import type Stripe from 'stripe';

/**
 * Cache a completed card checkout, so the record covers every payment type.
 *
 * The table held only the `report_payment` paths before this — credits at zero,
 * and cash — so a sum omitted the largest channel (#824) and `refund()`'s guard
 * had no card row to find (#828). Best-effort and last in the listener order: a
 * cache must not fail a checkout already paid for.
 */
export async function handleCheckoutCache(session: Stripe.Checkout.Session): Promise<void> {
	// The same id `checkout-listener.ts` writes onto the purchasable: the payment
	// intent where there is one, the session otherwise. Anything else and the
	// row cannot be joined back to what was bought.
	const paymentRecordId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: (session.payment_intent?.id ?? session.id);

	const userId = session.metadata?.user_id ?? null;
	// A guest ticket checkout has no member behind it. `payment_cache.user_id` is
	// NOT NULL, so those stay out rather than being attributed to nobody — the
	// ticket row is where a guest purchase is already recorded.
	if (!userId) return;

	const customerId =
		typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);

	try {
		await db.insert(paymentCache).values({
			id: paymentRecordId,
			userId,
			reservationId: session.metadata?.reservation_id ?? null,
			stripeCustomerId: customerId,
			amountCents: session.amount_total ?? 0,
			currency: session.currency ?? 'usd',
			paymentMethod: 'Card',
			status: 'completed',
			paidAt: new Date()
		});
	} catch (err) {
		// A UNIQUE collision is a Stripe retry of a webhook already handled, which
		// is the correct outcome rather than an error worth reporting.
		if (/UNIQUE constraint failed/i.test((err as Error).message ?? '')) return;
		captureException(err, { event: 'checkout.cache', paymentRecordId });
	}
}
