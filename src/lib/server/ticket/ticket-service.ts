import { db } from '$lib/server/db';
import { ticket, type TicketStatus } from '$lib/server/db/schema/ticket';
import { event } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, inArray, lt, sql, asc, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { TicketStatus };

export interface CreateTicketsOptions {
	eventId: string;
	purchaseId: string;
	quantity: number;
	userId?: string | null;
	attendeeName: string;
	attendeeEmail: string;
	status?: TicketStatus;
	/** What each pass cost after any member discount. 0 for comps and free claims. */
	unitPriceCents?: number;
	/** The order's optional gift. Lands on the first ticket only — see the schema. */
	contributionCents?: number;
	/** An eligible sustaining member paid full price on purpose. */
	discountWaived?: boolean;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------
// 8-character alphanumeric codes excluding ambiguous characters (0, O, I, L, 1)

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateCodeString(): string {
	const chars: string[] = [];
	for (let i = 0; i < CODE_LENGTH; i++) {
		chars.push(CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]);
	}
	return chars.join('');
}

/** Generate `count` unique codes that don't collide with existing tickets. */
async function generateUniqueCodes(count: number): Promise<string[]> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const candidates = Array.from({ length: count }, () => generateCodeString());

		const existing = await db
			.select({ code: ticket.code })
			.from(ticket)
			.where(inArray(ticket.code, candidates));

		const taken = new Set(existing.map((r) => r.code));
		const unique = candidates.filter((c) => !taken.has(c));

		if (unique.length >= count) return unique.slice(0, count);
		count -= unique.length;
	}
	throw new Error('Failed to generate unique ticket codes after 3 attempts');
}

// ---------------------------------------------------------------------------
// Create tickets
// ---------------------------------------------------------------------------

export async function createTickets(options: CreateTicketsOptions) {
	const {
		eventId,
		purchaseId,
		quantity,
		userId,
		attendeeName,
		attendeeEmail,
		status = 'pending',
		unitPriceCents = 0,
		contributionCents = 0,
		discountWaived = false
	} = options;

	const codes = await generateUniqueCodes(quantity);

	const rows = codes.map((code, i) => ({
		eventId,
		purchaseId,
		userId: userId ?? null,
		attendeeName,
		attendeeEmail,
		code,
		status,
		unitPriceCents,
		// The gift belongs to the order, not to any one pass. Writing it on every
		// row would multiply it by the quantity the moment anyone sums a purchase.
		contributionCents: i === 0 ? contributionCents : 0,
		discountWaived
	}));

	const created = await db.insert(ticket).values(rows).returning();
	return created;
}

// ---------------------------------------------------------------------------
// Fulfill purchase (webhook callback)
// ---------------------------------------------------------------------------

/**
 * Flip a purchase's `pending` tickets to `valid` and stamp them with the Stripe
 * Payment Record ID that paid for them. Status and payment id are set in the
 * same UPDATE so there is no window where a fulfilled ticket has no proof of
 * payment, and no read-modify-write against concurrent webhook deliveries.
 *
 * `stripePaymentRecordId` is omitted for purchases that never touch Stripe —
 * comped tickets (`comp-` prefix) and free RSVPs (`rsvp-` prefix).
 */
export async function fulfillPurchase(purchaseId: string, stripePaymentRecordId?: string) {
	const rows = await db
		.update(ticket)
		.set({
			status: 'valid',
			...(stripePaymentRecordId ? { stripePaymentRecordId } : {}),
			updatedAt: new Date()
		})
		.where(and(eq(ticket.purchaseId, purchaseId), eq(ticket.status, 'pending')))
		.returning();

	return rows;
}

// ---------------------------------------------------------------------------
// Cancel purchase
// ---------------------------------------------------------------------------

export async function cancelPurchase(purchaseId: string): Promise<number> {
	const rows = await db
		.update(ticket)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(and(eq(ticket.purchaseId, purchaseId), inArray(ticket.status, ['pending', 'valid'])))
		.returning({ id: ticket.id });

	return rows.length;
}

// ---------------------------------------------------------------------------
// Cancel stale pending tickets (cron sweep)
// ---------------------------------------------------------------------------

/**
 * Cancel `pending` tickets whose checkout was abandoned. Pending rows are
 * created before the Stripe redirect and flipped to `valid` by the
 * checkout.session.completed webhook; a Checkout Session lives at most 24h,
 * so anything still pending past that is an orphan. Returns the count.
 */
export async function cancelStalePendingTickets(olderThanHours = 24): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

	const rows = await db
		.update(ticket)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(and(eq(ticket.status, 'pending'), lt(ticket.createdAt, cutoff)))
		.returning({ id: ticket.id });

	return rows.length;
}

// ---------------------------------------------------------------------------
// Cancel individual ticket
// ---------------------------------------------------------------------------

export async function cancelTicket(ticketId: string): Promise<void> {
	const [row] = await db
		.select({ status: ticket.status })
		.from(ticket)
		.where(eq(ticket.id, ticketId))
		.limit(1);

	if (!row) throw new Error('Ticket not found');
	if (row.status !== 'pending' && row.status !== 'valid') {
		throw new Error(`Cannot cancel ticket with status "${row.status}"`);
	}

	await db
		.update(ticket)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(eq(ticket.id, ticketId));
}

// ---------------------------------------------------------------------------
// Check in
// ---------------------------------------------------------------------------

export async function checkIn(ticketId: string, staffUserId: string): Promise<void> {
	const [row] = await db
		.select({ status: ticket.status })
		.from(ticket)
		.where(eq(ticket.id, ticketId))
		.limit(1);

	if (!row) throw new Error('Ticket not found');
	if (row.status !== 'valid') throw new Error(`Cannot check in ticket with status "${row.status}"`);

	await db
		.update(ticket)
		.set({
			status: 'checked_in',
			checkedInAt: new Date(),
			checkedInByUserId: staffUserId,
			updatedAt: new Date()
		})
		.where(eq(ticket.id, ticketId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getTicketsByPurchase(purchaseId: string) {
	return db
		.select()
		.from(ticket)
		.where(eq(ticket.purchaseId, purchaseId))
		.orderBy(asc(ticket.code));
}

export async function getEventTickets(eventId: string, statusFilter?: TicketStatus[]) {
	const conditions = [eq(ticket.eventId, eventId)];
	if (statusFilter && statusFilter.length > 0) {
		conditions.push(inArray(ticket.status, statusFilter));
	}

	return db
		.select({
			id: ticket.id,
			eventId: ticket.eventId,
			purchaseId: ticket.purchaseId,
			userId: ticket.userId,
			attendeeName: ticket.attendeeName,
			attendeeEmail: ticket.attendeeEmail,
			code: ticket.code,
			status: ticket.status,
			unitPriceCents: ticket.unitPriceCents,
			contributionCents: ticket.contributionCents,
			discountWaived: ticket.discountWaived,
			checkedInAt: ticket.checkedInAt,
			checkedInByUserId: ticket.checkedInByUserId,
			checkedInByName: user.name,
			createdAt: ticket.createdAt
		})
		.from(ticket)
		.leftJoin(user, eq(user.id, ticket.checkedInByUserId))
		.where(and(...conditions))
		.orderBy(asc(ticket.attendeeName), asc(ticket.code));
}

export async function getTicketsSold(eventId: string): Promise<number> {
	const [result] = await db
		.select({ count: sql<number>`cast(count(*) as integer)` })
		.from(ticket)
		.where(and(eq(ticket.eventId, eventId), inArray(ticket.status, ['valid', 'checked_in'])));

	return result?.count ?? 0;
}

export async function getTicketsRemaining(eventId: string): Promise<number | null> {
	const [ev] = await db
		.select({ ticketQuantity: event.ticketQuantity })
		.from(event)
		.where(eq(event.id, eventId))
		.limit(1);

	if (!ev || ev.ticketQuantity == null) return null;

	const sold = await getTicketsSold(eventId);
	return Math.max(0, ev.ticketQuantity - sold);
}

export async function getUserTickets(userId: string) {
	return db
		.select({
			id: ticket.id,
			eventId: ticket.eventId,
			purchaseId: ticket.purchaseId,
			code: ticket.code,
			status: ticket.status,
			attendeeName: ticket.attendeeName,
			checkedInAt: ticket.checkedInAt,
			createdAt: ticket.createdAt,
			eventTitle: event.title,
			eventStartsAt: event.startsAt,
			eventEndsAt: event.endsAt
		})
		.from(ticket)
		.innerJoin(event, eq(event.id, ticket.eventId))
		.where(and(eq(ticket.userId, userId), inArray(ticket.status, ['valid', 'checked_in'])))
		.orderBy(desc(event.startsAt), asc(ticket.code));
}
