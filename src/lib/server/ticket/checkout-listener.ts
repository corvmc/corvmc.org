import type Stripe from 'stripe';
import { fulfillPurchase } from './ticket-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { db } from '$lib/server/db';
import { event } from '$lib/server/db/schema/event';
import { eq } from 'drizzle-orm';
import { formatDateFull, formatTimeSimple } from '$lib/server/reservation/timezone';
import { captureException } from '$lib/server/sentry';
import { DEFAULT_TIMEZONE } from '$lib/config';

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
		const eventId = tickets[0].eventId;
		const [eventRow] = await db.select().from(event).where(eq(event.id, eventId)).limit(1);
		if (!eventRow) return;

		const TZ = DEFAULT_TIMEZONE;

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

		await domainEvents.emit('ticket.purchased', {
			purchaseId,
			eventId,
			attendeeName: tickets[0].attendeeName,
			attendeeEmail: tickets[0].attendeeEmail,
			eventTitle: eventRow.title,
			eventDate: formatDateFull(eventRow.startsAt, TZ),
			eventTime: formatTimeSimple(eventRow.startsAt, TZ),
			ticketCodes: tickets.map((t) => t.code),
			quantity: tickets.length,
			unitPriceCents,
			subtotalCents,
			contributionCents,
			feesCents,
			totalCents
		});
	} catch (err) {
		// The tickets are already valid at this point — a failure here costs the
		// buyer their receipt, so it belongs in Sentry, not just Worker logs.
		captureException(err, { scope: 'ticket.purchased', purchaseId });
	}
}
