/**
 * The `ticket.purchased` emit, in one place.
 *
 * Two flows mint valid tickets and owe the buyer a receipt: a Stripe checkout
 * completing, and a $0 purchase on a show whose sliding scale runs to free. The
 * second never touches Stripe, so it has no session to read amounts off — but
 * the buyer walked through the same form and is owed the same email, and a
 * second copy of the event lookup and payload assembly would drift from the
 * first the moment either receipt changed.
 */
import { db } from '$lib/server/db';
import { event } from '$lib/server/db/schema/event';
import { ticket } from '$lib/server/db/schema/ticket';
import { eq } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { formatDateFull, formatTimeSimple } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

type TicketRow = typeof ticket.$inferSelect;

/** The money half of the receipt, which only the caller can work out. */
export type PurchaseAmounts = {
	unitPriceCents: number;
	subtotalCents: number;
	contributionCents: number;
	feesCents: number;
	totalCents: number;
	actsCents: number;
	collectiveCents: number;
};

export async function emitTicketPurchased(
	purchaseId: string,
	tickets: TicketRow[],
	amounts: PurchaseAmounts
): Promise<void> {
	if (tickets.length === 0) return;

	const eventId = tickets[0].eventId;
	const [eventRow] = await db.select().from(event).where(eq(event.id, eventId)).limit(1);
	if (!eventRow) return;

	const TZ = DEFAULT_TIMEZONE;

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
		...amounts
	});
}
