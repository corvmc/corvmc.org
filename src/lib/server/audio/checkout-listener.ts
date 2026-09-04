import type Stripe from 'stripe';
import { fulfillPurchase } from './purchase-service';

/**
 * Turn a completed Stripe checkout into a delivered record.
 *
 * Registered on the domain bus alongside the reservation, ticket and band-premium
 * listeners. Each opens with a metadata guard and returns immediately when the
 * session is not theirs — the webhook emits one event and the listeners
 * self-select, so a session type nobody claims is silently ignored rather than
 * being an error somewhere.
 */
export async function handleAudioCheckout(session: Stripe.Checkout.Session): Promise<void> {
	if (session.metadata?.type !== 'audio_purchase') return;

	const purchaseId = session.metadata?.purchase_id;
	if (!purchaseId) return;

	// Both ids are kept. The rest of the app treats a Payment Record as proof of
	// payment, but a Connect refund operates on the *charge* — reversing a
	// transfer and refunding an application fee are things you do to a
	// PaymentIntent, not to the record describing it.
	const paymentIntentId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: (session.payment_intent?.id ?? null);

	// `fulfillPurchase` is idempotent on the pending status, so a Stripe
	// redelivery matches no rows and cannot send the buyer a second receipt.
	await fulfillPurchase(purchaseId, paymentIntentId, paymentIntentId ?? session.id);
}
