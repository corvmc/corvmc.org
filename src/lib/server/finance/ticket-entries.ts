import {
	recordEntries,
	recordEntry,
	reverseEntriesForSubject,
	type RecordEntryInput
} from './financial-entry-service';
import { showProjectIdForEvent } from './show-project';

/**
 * A free ticket, recorded as the $0 sale it is.
 *
 * NOTAFLOF means the scale reaches zero and Stripe is never involved, so
 * nothing else would leave a trace. Without the row, "10 tickets, 3 free" is
 * indistinguishable from "7 tickets" — and how many people a free show
 * actually reached is the number a funder asks for.
 */
export async function recordFreeTicketSale(params: {
	purchaseId: string;
	eventId: string;
	quantity: number;
	userId?: string | null;
	occurredAt: Date;
}): Promise<void> {
	await recordEntry({
		amountCents: 0,
		kind: 'earned',
		category: 'ticket_sales',
		occurredAt: params.occurredAt,
		// No money moved at all — not cash, not a credit, not Stripe.
		settlement: 'none',
		subjectType: 'ticket',
		subjectId: params.purchaseId,
		projectId: await showProjectIdForEvent(params.eventId),
		userId: params.userId ?? null,
		description: `${params.quantity} free ticket${params.quantity === 1 ? '' : 's'}`,
		metadata: { eventId: params.eventId, quantity: params.quantity }
	});
}

/**
 * Giving a band's ticket sale back (#1472).
 *
 * The refund reverses the transfer and the application fee on the charge, so
 * both legs the sale wrote come back. Keyed on the purchase, as the sale was.
 */
export async function recordBandTicketRefund(purchaseId: string): Promise<void> {
	await reverseEntriesForSubject('ticket', purchaseId);
}

/**
 * A card-present sale at the door (#612): the rows an online collective ticket
 * writes, keyed on the PaymentIntent that is also the `purchaseId`. There is
 * no buyer account, and no fee coverage at the door.
 */
export async function recordDoorTicketSale(params: {
	purchaseId: string;
	eventId: string;
	chargeCents: number;
	actsCents: number;
	collectiveCents: number;
	feeCents: number;
	occurredAt: Date;
}): Promise<void> {
	const base = {
		occurredAt: params.occurredAt,
		settlement: 'stripe' as const,
		stripePaymentRecordId: params.purchaseId,
		userId: null,
		subjectType: 'ticket' as const,
		subjectId: params.purchaseId,
		projectId: await showProjectIdForEvent(params.eventId)
	};
	const entries: RecordEntryInput[] = [];
	if (params.collectiveCents > 0) {
		entries.push({
			...base,
			amountCents: params.collectiveCents,
			kind: 'earned',
			category: 'ticket_sales',
			description: 'Ticket sale, door, card present'
		});
	}
	if (params.actsCents > 0) {
		entries.push({
			...base,
			amountCents: params.actsCents,
			kind: 'pass_through',
			category: 'act_payout',
			settlementGroup: params.eventId,
			description: 'Door, designated to the acts'
		});
	}
	if (params.feeCents > 0) {
		entries.push({
			...base,
			amountCents: -params.feeCents,
			kind: 'spent',
			category: 'card_fees',
			description: 'Card processing, in person'
		});
	}
	await recordEntries(entries);
}
