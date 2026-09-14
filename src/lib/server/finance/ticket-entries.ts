import { recordEntry } from './financial-entry-service';

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
		userId: params.userId ?? null,
		description: `${params.quantity} free ticket${params.quantity === 1 ? '' : 's'}`,
		metadata: { eventId: params.eventId, quantity: params.quantity }
	});
}
