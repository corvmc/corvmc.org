import { db } from '#lib/server/db/index.js';
import { ticket } from '#lib/server/db/schema/ticket.js';
import { eventBand, eventListing } from '#lib/server/db/schema/event.js';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import {
	cancelTicket,
	getTicketsRemaining,
	issueFreeTickets,
	recordTicketComp
} from './ticket-service';

/**
 * Guests per act (#3274): a free ticket tied to the credit it was issued for.
 *
 * A guest is a one-seat comp with `ticket.event_band_id` set. It goes through
 * `issueFreeTickets`, so the holder gets the ordinary ticket email, and it
 * counts against the sale's capacity like any other issued ticket.
 */

export class GuestNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Guest not found');
	}
}

export class GuestRefusedError extends DomainError {
	readonly httpStatus = 409;

	constructor(message: string) {
		super(message);
	}
}

export type ActGuest = {
	id: string;
	eventBandId: string;
	name: string;
	email: string;
	status: 'pending' | 'valid' | 'checked_in';
};

/** Every live guest of one show, in name order. */
export async function listGuestsByAct(eventId: string): Promise<ActGuest[]> {
	const rows = await db
		.select({
			id: ticket.id,
			eventBandId: ticket.eventBandId,
			name: ticket.attendeeName,
			email: ticket.attendeeEmail,
			status: ticket.status
		})
		.from(ticket)
		.where(
			and(
				eq(ticket.eventId, eventId),
				isNotNull(ticket.eventBandId),
				ne(ticket.status, 'cancelled')
			)
		)
		.orderBy(asc(ticket.attendeeName), asc(ticket.code));
	return rows as ActGuest[];
}

/** The show a credit is on, read from the row so a guard never trusts the client. */
export async function eventOfAct(eventBandId: string): Promise<string | null> {
	const [row] = await db
		.select({ eventId: eventBand.eventId })
		.from(eventBand)
		.where(eq(eventBand.id, eventBandId))
		.limit(1);
	return row?.eventId ?? null;
}

/** The show a guest ticket is for, or null when the ticket is not a guest's. */
export async function eventOfGuest(ticketId: string): Promise<string | null> {
	const [row] = await db
		.select({ eventId: ticket.eventId, eventBandId: ticket.eventBandId })
		.from(ticket)
		.where(eq(ticket.id, ticketId))
		.limit(1);
	return row?.eventBandId ? row.eventId : null;
}

export async function addGuest(input: { eventBandId: string; name: string; email: string }) {
	const [act] = await db
		.select({ eventId: eventBand.eventId, status: eventListing.status })
		.from(eventBand)
		.innerJoin(eventListing, eq(eventListing.id, eventBand.eventId))
		.where(eq(eventBand.id, input.eventBandId))
		.limit(1);
	if (!act) throw new GuestRefusedError('That act is not on the bill');
	if (act.status === 'cancelled') throw new GuestRefusedError('The show is cancelled');

	const remaining = await getTicketsRemaining(act.eventId);
	if (remaining !== null && remaining < 1) throw new GuestRefusedError('No tickets remaining');

	const purchaseId = `comp-${crypto.randomUUID()}`;
	const [issued] = await issueFreeTickets({
		eventId: act.eventId,
		purchaseId,
		quantity: 1,
		attendeeName: input.name,
		attendeeEmail: input.email,
		eventBandId: input.eventBandId
	});
	await recordTicketComp({
		eventId: act.eventId,
		purchaseId,
		quantity: 1,
		attendeeName: input.name
	});
	return issued;
}

/** Cancel one guest. Any other ticket is refused: those go through `cancelTicket`. */
export async function removeGuest(ticketId: string): Promise<void> {
	if (!(await eventOfGuest(ticketId))) throw new GuestNotFoundError();
	await cancelTicket(ticketId);
}

/**
 * The statement that cancels the unused guests of these credits, for a batch
 * that deletes them. `checked_in` stays: that guest came. No email is sent.
 */
export function cancelGuestsOfActs(eventBandIds: string[]) {
	return db
		.update(ticket)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(
			and(inArray(ticket.eventBandId, eventBandIds), inArray(ticket.status, ['pending', 'valid']))
		);
}
