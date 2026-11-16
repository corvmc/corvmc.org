import type Stripe from 'stripe';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { and, eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Reservation checkout listener
// ---------------------------------------------------------------------------
// Called by the domain event bus when a checkout completes. Inspects session
// metadata for a reservation_id and records the payment on the confirmed row.
// It does not announce: the row was announced when it was confirmed (#2502).
// ---------------------------------------------------------------------------

export async function handleReservationCheckout(session: Stripe.Checkout.Session): Promise<void> {
	const reservationId = session.metadata?.reservation_id;
	if (!reservationId) return;

	// The payment record ID comes from the session's payment_intent or the session ID itself
	const paymentRecordId = session.payment_intent
		? typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent.id
		: session.id;

	await db
		.update(reservation)
		.set({
			stripePaymentRecordId: paymentRecordId,
			paidAt: new Date(),
			cashDueCents: 0,
			updatedAt: new Date()
		})
		.where(and(eq(reservation.id, reservationId), eq(reservation.status, 'confirmed')));
}
