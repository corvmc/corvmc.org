import type { TicketStatus } from '#lib/server/db/schema/ticket.js';

/**
 * The tickets a door list carries (#2797): everything but an unpaid `pending`
 * hold. A cancelled ticket stays in, stamped with when, so a scan or a search
 * can say why it will not go in; the pages leave it off their default list.
 * Every door list reads through this, so none drops what the door must explain.
 */
export function doorListTickets<T extends { status: TicketStatus; updatedAt: Date }>(
	tickets: T[]
): (T & { cancelledAt: Date | null })[] {
	return tickets
		.filter((t) => t.status !== 'pending')
		.map((t) => ({ ...t, cancelledAt: t.status === 'cancelled' ? t.updatedAt : null }));
}
