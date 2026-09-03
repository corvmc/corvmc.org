import type Stripe from 'stripe';
import { fulfillPurchase } from './ticket-service';
import { emitTicketPurchased } from './purchased-event';
import { captureException } from '$lib/server/sentry';

// ---------------------------------------------------------------------------
// Ticket checkout listener
// ---------------------------------------------------------------------------
// Called by the domain event bus when a checkout completes. Inspects session
// metadata for type=ticket and a purchase_id, then transitions all pending
// tickets for that purchase to valid and emits a ticket.purchased event.
// ---------------------------------------------------------------------------

export async function handleTicketCheckout(session: Stripe.Checkout.Session): Promise<void> {
	if (session.metadata?.type !== 'ticket') return;

	const purchaseId = session.metadata?.purchase_id;
	if (!purchaseId) return;

	// The payment record ID comes from the session's payment_intent or the
	// session ID itself — same resolution as handleReservationCheckout.
	const paymentRecordId = session.payment_intent
		? typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent.id
		: session.id;

	// fulfillPurchase returns the updated rows directly, avoiding a
	// separate query that could race with concurrent writes. It writes the
	// payment record id in the same UPDATE as the status flip.
	const tickets = await fulfillPurchase(purchaseId, paymentRecordId);
	if (tickets.length === 0) return;

	// Emit ticket.purchased for notification dispatch
	try {
		// Receipt amounts. The buyer may have no account, so the confirmation
		// email is their only record of what they paid — it has to break the
		// charge down, not just state a total.
		//
		// Stripe's amount_subtotal covers every line item, and fee coverage is
		// just another one, so the ticket portion is only recoverable from the
		// unit price we stamped on the session at checkout. Sessions predating
		// that metadata fall back to reporting the total with no fee line rather
		// than booking the whole charge as fees.
		//
		// An optional contribution is a line item of its own, so it lands inside
		// amount_subtotal too. It has to come out before the remainder can be
		// called fees, or the buyer's gift is reported back to them as a
		// processing charge.
		const unitPriceCents = Number(session.metadata?.ticket_unit_price_cents) || 0;
		const contributionCents = Number(session.metadata?.ticket_contribution_cents) || 0;
		const totalCents = session.amount_total ?? 0;
		const subtotalCents = unitPriceCents > 0 ? unitPriceCents * tickets.length : totalCents;
		const feesCents = Math.max(
			0,
			(session.amount_subtotal ?? totalCents) - subtotalCents - contributionCents
		);

		// The allocation is read off the rows rather than the session: it was
		// written before the buyer ever reached Stripe, and `fulfillPurchase` has
		// already handed the rows back, so it costs nothing. The session metadata
		// carries it too, but for settle-time reconciliation against Stripe, not
		// for this.
		const order = tickets.find((t) => t.actsCents > 0 || t.collectiveCents > 0) ?? tickets[0];

		await emitTicketPurchased(purchaseId, tickets, {
			unitPriceCents,
			subtotalCents,
			contributionCents,
			feesCents,
			totalCents,
			actsCents: order.actsCents,
			collectiveCents: order.collectiveCents
		});
	} catch (err) {
		// The tickets are already valid at this point — a failure here costs the
		// buyer their receipt, so it belongs in Sentry, not just Worker logs.
		captureException(err, { scope: 'ticket.purchased', purchaseId });
	}
}
