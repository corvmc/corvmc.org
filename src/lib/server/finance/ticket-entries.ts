import {
	recordEntries,
	recordEntry,
	reverseEntriesForSubject,
	type RecordEntryInput
} from './financial-entry-service';
import { showProjectIdForEvent } from './show-project';
import type { TicketSplit } from '#lib/finance/ticket-split.js';

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
 * The split, as an online ticket's checkout session carries it. The receipt
 * reads the ticket line and the gift; `handleCheckoutEntries` reads the acts'
 * share and the covered fee, and the collective earns the rest of the charge.
 */
export function ticketSplitMetadata(split: TicketSplit): Record<string, string> {
	return {
		ticket_unit_price_cents: String(split.ticketLineUnitCents),
		ticket_contribution_cents: String(split.contributionCents),
		ticket_acts_cents: String(split.actsCents),
		ticket_collective_cents: String(split.collectiveCents),
		ticket_fee_covered_cents: String(split.feeCoveredCents)
	};
}

/**
 * What the collective earned on a ticket: everything the acts are not owed,
 * before the card fee. The split's own `collectiveCents` is after the fee, and
 * the fee is its own `spent` row, so earning that figure counts the fee twice
 * (#2731). The covered part is `fee_coverage`; neither row goes negative.
 */
export function collectiveGross(input: {
	chargeCents: number;
	actsCents: number;
	feeCoveredCents: number;
}): { ticketSalesCents: number; feeCoveredCents: number } {
	const keptCents = Math.max(0, input.chargeCents - input.actsCents);
	const feeCoveredCents = Math.min(keptCents, Math.max(0, input.feeCoveredCents));
	return { ticketSalesCents: keptCents - feeCoveredCents, feeCoveredCents };
}

/**
 * A sale at the door (#612): the rows an online collective ticket writes, keyed
 * on the `purchaseId` — the PaymentIntent for a card, `cash-…` for cash
 * (#2800), which settles in the drawer and has no fee. There is no buyer
 * account, and no fee coverage at the door.
 */
export async function recordDoorTicketSale(params: {
	purchaseId: string;
	eventId: string;
	chargeCents: number;
	actsCents: number;
	feeCents: number;
	occurredAt: Date;
	payment?: 'card' | 'cash';
}): Promise<void> {
	const cash = params.payment === 'cash';
	const { ticketSalesCents } = collectiveGross({ ...params, feeCoveredCents: 0 });
	const base = {
		occurredAt: params.occurredAt,
		settlement: cash ? ('cash' as const) : ('stripe' as const),
		stripePaymentRecordId: cash ? null : params.purchaseId,
		userId: null,
		subjectType: 'ticket' as const,
		subjectId: params.purchaseId,
		projectId: await showProjectIdForEvent(params.eventId)
	};
	const entries: RecordEntryInput[] = [];
	if (ticketSalesCents > 0) {
		entries.push({
			...base,
			amountCents: ticketSalesCents,
			kind: 'earned',
			category: 'ticket_sales',
			description: cash ? 'Ticket sale, door, cash' : 'Ticket sale, door, card present'
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
