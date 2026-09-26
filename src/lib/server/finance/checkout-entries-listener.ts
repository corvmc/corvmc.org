import { calculateProcessingFee } from '$lib/finance/fees';
import { recordEntriesBestEffort, type RecordEntryInput } from './financial-entry-service';
import { showProjectIdForEvent } from './show-project';
import type Stripe from 'stripe';

/**
 * Write a completed checkout into the financial record.
 *
 * A sale is several rows that only make sense together — see the worked example
 * in `docs/specs/financial-record-spec.md`. The allocation is already in the
 * session metadata, put there so a settlement could read it.
 */
export async function handleCheckoutEntries(session: Stripe.Checkout.Session): Promise<void> {
	const meta = session.metadata ?? {};
	const userId = meta.user_id ?? null;
	const paymentRecordId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: (session.payment_intent?.id ?? session.id);

	const occurredAt = new Date();
	const cents = (key: string) => Number(meta[key]) || 0;

	// The card fee is always recorded, whoever funded it. Otherwise it is
	// queryable for the sales a member covered and invisible for the rest.
	const chargeCents = session.amount_total ?? 0;
	const feeCents = calculateProcessingFee(chargeCents);

	const entries: RecordEntryInput[] = [];
	const base = {
		occurredAt,
		settlement: 'stripe' as const,
		stripePaymentRecordId: paymentRecordId,
		userId
	};

	if (meta.type === 'ticket' && meta.ticket_seller_group_id) {
		// A band's own gig (#1203) is a destination charge, on the pattern of
		// `audio-entries.ts`: the band's share goes to its own account at the sale
		// and is never the collective's, so it is not entered at all. What the
		// collective earns is the application fee, and Stripe's fee comes out of it.
		const ticketId = meta.purchase_id ?? session.id;
		const applicationFeeCents = chargeCents - cents('ticket_acts_cents');
		const bandBase = {
			...base,
			subjectType: 'ticket' as const,
			subjectId: ticketId,
			metadata: { eventId: meta.event_id ?? null, groupId: meta.ticket_seller_group_id }
		};
		if (applicationFeeCents > 0) {
			entries.push({
				...bandBase,
				amountCents: applicationFeeCents,
				kind: 'earned',
				category: 'band_ticket_sales',
				description: 'Band ticket sale, the collective share'
			});
		}
		if (feeCents > 0) {
			entries.push({
				...bandBase,
				amountCents: -feeCents,
				kind: 'spent',
				category: 'card_fees',
				description: 'Card processing'
			});
		}
	} else if (meta.type === 'ticket') {
		const eventId = meta.event_id ?? null;
		const ticketId = meta.purchase_id ?? session.id;
		// Every leg of a show's sale counts toward its project's burn.
		const projectId = await showProjectIdForEvent(eventId);
		const actsCents = cents('ticket_acts_cents');
		const collectiveCents = cents('ticket_collective_cents');
		const feeCoveredCents = cents('ticket_fee_covered_cents');

		if (collectiveCents > 0) {
			entries.push({
				...base,
				amountCents: collectiveCents,
				kind: 'earned',
				category: 'ticket_sales',
				subjectType: 'ticket',
				subjectId: ticketId,
				projectId,
				description: 'Ticket sale'
			});
		}
		if (actsCents > 0) {
			entries.push({
				...base,
				amountCents: actsCents,
				kind: 'pass_through',
				category: 'act_payout',
				// The pool the acts are paid out of, keyed on the show rather than
				// the ticket: money arrives in many rows and leaves in one.
				settlementGroup: eventId,
				subjectType: 'ticket',
				subjectId: ticketId,
				projectId,
				description: 'Door, designated to the acts'
			});
		}
		if (feeCoveredCents > 0) {
			entries.push({
				...base,
				amountCents: feeCoveredCents,
				kind: 'earned',
				category: 'fee_coverage',
				subjectType: 'ticket',
				subjectId: ticketId,
				projectId,
				description: 'Buyer covered card processing'
			});
		}
		if (feeCents > 0) {
			entries.push({
				...base,
				amountCents: -feeCents,
				kind: 'spent',
				category: 'card_fees',
				subjectType: 'ticket',
				subjectId: ticketId,
				projectId,
				description: 'Card processing'
			});
		}
	} else if (meta.type === 'market_vendor_fee' && meta.vendor_id) {
		if (chargeCents > 0) {
			const subject = { subjectType: 'market_vendor' as const, subjectId: meta.vendor_id };
			entries.push({
				...base,
				...subject,
				amountCents: chargeCents,
				kind: 'earned',
				category: 'market_fees',
				description: 'Market vendor table fee'
			});
			entries.push({
				...base,
				...subject,
				amountCents: -feeCents,
				kind: 'spent',
				category: 'card_fees',
				description: 'Card processing'
			});
		}
	} else if (meta.reservation_id) {
		const net = chargeCents - feeCents;
		if (net > 0) {
			entries.push({
				...base,
				amountCents: chargeCents,
				kind: 'earned',
				category: 'reservation',
				subjectType: 'reservation',
				subjectId: meta.reservation_id,
				description: 'Practice room'
			});
			entries.push({
				...base,
				amountCents: -feeCents,
				kind: 'spent',
				category: 'card_fees',
				subjectType: 'reservation',
				subjectId: meta.reservation_id,
				description: 'Card processing'
			});
		}
	}

	await recordEntriesBestEffort(entries);
}
