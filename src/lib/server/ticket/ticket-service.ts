import { db } from '$lib/server/db';
import { ticket, type TicketStatus } from '$lib/server/db/schema/ticket';
import { event } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, inArray, lt, sql, asc, desc } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { emitTicketPurchased } from './purchased-event';
import { captureException } from '$lib/server/sentry';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The ticket does not exist. */
export class TicketNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Ticket not found');
	}
}

/** The ticket is not in a status that allows the requested operation. */
export class TicketStateError extends DomainError {
	readonly httpStatus = 409;

	constructor(message: string) {
		super(message);
	}
}

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
	/** An eligible sustaining member paid full price on purpose. No longer written. */
	discountWaived?: boolean;
	/**
	 * Where the buyer asked their money to go. Order-level, like the gift, so all
	 * three land on the purchase's first ticket only.
	 */
	actsCents?: number;
	collectiveCents?: number;
	feeCoveredCents?: number;
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
		discountWaived = false,
		actsCents = 0,
		collectiveCents = 0,
		feeCoveredCents = 0
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
		// The gift and the allocation belong to the order, not to any one pass.
		// Writing them on every row would multiply them by the quantity the moment
		// anyone sums a purchase.
		contributionCents: i === 0 ? contributionCents : 0,
		actsCents: i === 0 ? actsCents : 0,
		collectiveCents: i === 0 ? collectiveCents : 0,
		feeCoveredCents: i === 0 ? feeCoveredCents : 0,
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
 * comped tickets (`comp-` prefix), free RSVPs (`rsvp-` prefix), and a $0
 * purchase on a sliding scale that runs to free (`free-` prefix). The last
 * never reaches this function at all: `issueFreeTickets` writes those rows
 * `valid` outright, since there is no webhook coming to flip them.
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

	if (!row) throw new TicketNotFoundError();
	if (row.status !== 'pending' && row.status !== 'valid') {
		throw new TicketStateError(`Cannot cancel ticket with status "${row.status}"`);
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

	if (!row) throw new TicketNotFoundError();
	if (row.status !== 'valid')
		throw new TicketStateError(`Cannot check in ticket with status "${row.status}"`);

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
			actsCents: ticket.actsCents,
			collectiveCents: ticket.collectiveCents,
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

/**
 * Mint tickets that are valid the moment they are written, and send the receipt.
 *
 * The one place that does this. A $0 purchase on a scale that runs to free never
 * touches Stripe, so no webhook is coming to flip anything — and neither does a
 * free event's claim. Both walked through a form and are owed their codes; a
 * second copy of this would be the one that forgets the email, which is what
 * `claimFreeTicket` did on its own for as long as it existed.
 */
export async function issueFreeTickets(options: Omit<CreateTicketsOptions, 'status'>) {
	const tickets = await createTickets({ ...options, status: 'valid' });

	// The receipt is worth a try/catch of its own: the tickets are already valid,
	// so a failure here costs the buyer their codes by email but not their seats.
	try {
		await emitTicketPurchased(options.purchaseId, tickets, {
			unitPriceCents: 0,
			subtotalCents: 0,
			contributionCents: 0,
			feesCents: 0,
			totalCents: 0,
			actsCents: 0,
			collectiveCents: 0
		});
	} catch (err) {
		captureException(err, { scope: 'ticket.purchased', purchaseId: options.purchaseId });
	}

	return tickets;
}

/**
 * How many live tickets one email already holds for one event, across every
 * purchase.
 *
 * Only meaningful for the free path. A paid ticket has a card behind it, which
 * is friction enough; a free one has none, and the 1–10 cap on the form is per
 * submission rather than per person — so without this, ten requests mint a
 * sold-out show that nobody can get into.
 */
export async function countTicketsForEmail(
	eventId: string,
	attendeeEmail: string
): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(ticket)
		.where(
			and(
				eq(ticket.eventId, eventId),
				eq(ticket.attendeeEmail, attendeeEmail),
				inArray(ticket.status, ['valid', 'checked_in', 'pending'])
			)
		);
	return row?.count ?? 0;
}

/** The show's money, as sold. */
export interface EventTicketMoney {
	/** Ticket line revenue: the sum of what each pass cost. */
	ticketsCents: number;
	/** Gifts above the suggested price, counted once per purchase. */
	contributionsCents: number;
	/** What buyers directed to the bill, and to the collective. */
	actsCents: number;
	collectiveCents: number;
	/** Surcharges from buyers who covered card processing. */
	feeCoveredCents: number;
	/** How many of the live tickets cost nothing. */
	freeCount: number;
	paidCount: number;
}

/**
 * What an event's live tickets add up to.
 *
 * Summed in SQL, over `valid` and `checked_in` only — a cancelled ticket's money
 * is not the show's money, and a `pending` one is a checkout nobody finished.
 * The order-level columns are written on each purchase's first row, so a plain
 * sum counts them exactly once without de-duplication.
 *
 * **"As sold", not "as settled".** The only refund mechanism is a human in the
 * Stripe dashboard, which nothing here can see, so a partly-refunded purchase
 * still reports its whole allocation. Settlement reconciles against Stripe.
 */
export async function getEventTicketMoney(eventId: string): Promise<EventTicketMoney> {
	const [row] = await db
		.select({
			ticketsCents: sql<number>`coalesce(sum(${ticket.unitPriceCents}), 0)`,
			contributionsCents: sql<number>`coalesce(sum(${ticket.contributionCents}), 0)`,
			actsCents: sql<number>`coalesce(sum(${ticket.actsCents}), 0)`,
			collectiveCents: sql<number>`coalesce(sum(${ticket.collectiveCents}), 0)`,
			feeCoveredCents: sql<number>`coalesce(sum(${ticket.feeCoveredCents}), 0)`,
			freeCount: sql<number>`sum(case when coalesce(${ticket.unitPriceCents}, 0) = 0 then 1 else 0 end)`,
			paidCount: sql<number>`sum(case when coalesce(${ticket.unitPriceCents}, 0) > 0 then 1 else 0 end)`
		})
		.from(ticket)
		.where(and(eq(ticket.eventId, eventId), inArray(ticket.status, ['valid', 'checked_in'])));

	return {
		ticketsCents: row?.ticketsCents ?? 0,
		contributionsCents: row?.contributionsCents ?? 0,
		actsCents: row?.actsCents ?? 0,
		collectiveCents: row?.collectiveCents ?? 0,
		feeCoveredCents: row?.feeCoveredCents ?? 0,
		freeCount: row?.freeCount ?? 0,
		paidCount: row?.paidCount ?? 0
	};
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
