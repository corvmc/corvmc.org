import { db, getRowCount } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import {
	eq,
	ne,
	and,
	or,
	lt,
	gt,
	gte,
	desc,
	asc,
	count,
	isNull,
	isNotNull,
	inArray,
	notInArray
} from 'drizzle-orm';
import { validateBooking } from './conflict-service';
import { refund } from '$lib/server/finance/payment-service';
import { reverseReservationCredits } from './reservation-credit-service';
import { domainEvents } from '$lib/server/events/event-bus';
import { user } from '$lib/server/db/schema/authentication';
import { band, bandMember } from '$lib/server/db/schema/band';
import { formatDateInTz, formatTimeInTz } from './timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';
import type { BookerType, ReservationStatus } from '$lib/server/db/schema/reservation';

// ---------------------------------------------------------------------------
// ReservationService — create and cancel reservations
// ---------------------------------------------------------------------------

export class ReservationConflictError extends Error {
	constructor() {
		super('Time slot is not available');
		this.name = 'ReservationConflictError';
	}
}

export class ReservationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationValidationError';
	}
}

/**
 * Thrown when a reservation can't transition to the requested state — e.g.
 * cancelling an already-cancelled reservation, or a concurrent status change.
 * These are expected conflicts (stale UI, double-click), not server faults.
 */
export class ReservationStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationStateError';
	}
}

export class ReservationNotFoundError extends Error {
	constructor() {
		super('Reservation not found');
		this.name = 'ReservationNotFoundError';
	}
}

export class ReservationAuthorizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationAuthorizationError';
	}
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

export interface CreateReservationParams {
	userId: string;
	bookerType: BookerType;
	bookerId: string;
	startsAt: Date;
	endsAt: Date;
	notes?: string;
}

export interface ReservationRow {
	id: string;
	bookerType: string;
	bookerId: string;
	createdByUserId: string;
	status: string;
	startsAt: Date;
	endsAt: Date;
	notes: string | null;
	cancellationReason: string | null;
	stripePaymentRecordId: string | null;
	lockAccessId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export async function create(params: CreateReservationParams): Promise<ReservationRow> {
	const { userId, bookerType, bookerId, startsAt, endsAt, notes } = params;

	// Validate time constraints
	const validation = await validateBooking(startsAt, endsAt);
	if (!validation.valid) {
		throw new ReservationValidationError(validation.error!);
	}

	// Conflict check then insert (D1 doesn't support interactive transactions)
	const conflicts = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, endsAt),
				gt(reservation.endsAt, startsAt)
			)
		);

	if (conflicts.length > 0) {
		throw new ReservationConflictError();
	}

	const [row] = await db
		.insert(reservation)
		.values({
			bookerType,
			bookerId,
			createdByUserId: userId,
			status: 'scheduled',
			startsAt,
			endsAt,
			notes: notes ?? null
		})
		.returning();

	// Post-insert re-check narrows the check-then-insert race: two concurrent
	// bookings can both pass the check above, but at least one of them sees the
	// other here and backs out (compensating delete — no transactions on D1).
	const raced = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				ne(reservation.id, row.id),
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, endsAt),
				gt(reservation.endsAt, startsAt)
			)
		);

	if (raced.length > 0) {
		await db.delete(reservation).where(eq(reservation.id, row.id));
		throw new ReservationConflictError();
	}

	return row;
}

// ---------------------------------------------------------------------------
// createWaitlisted() — create with waitlisted status (skip conflict check)
// ---------------------------------------------------------------------------

export async function createWaitlisted(params: CreateReservationParams): Promise<ReservationRow> {
	const { userId, bookerType, bookerId, startsAt, endsAt, notes } = params;

	const validation = await validateBooking(startsAt, endsAt);
	if (!validation.valid) {
		throw new ReservationValidationError(validation.error!);
	}

	const [row] = await db
		.insert(reservation)
		.values({
			bookerType,
			bookerId,
			createdByUserId: userId,
			status: 'waitlisted',
			startsAt,
			endsAt,
			notes: notes ?? null
		})
		.returning();

	return row;
}

// ---------------------------------------------------------------------------
// staffCreate() — skip validation and conflict checks
// ---------------------------------------------------------------------------

export interface StaffCreateReservationParams extends CreateReservationParams {
	status?: ReservationStatus;
	/** The staff member performing the booking — recorded as the audit trail. */
	staffUserId?: string;
}

export async function staffCreate(params: StaffCreateReservationParams): Promise<ReservationRow> {
	const {
		userId,
		bookerType,
		bookerId,
		startsAt,
		endsAt,
		notes,
		status = 'confirmed',
		staffUserId
	} = params;

	if (startsAt >= endsAt)
		throw new ReservationValidationError('Reservation must end after it starts');

	const [row] = await db
		.insert(reservation)
		.values({
			bookerType,
			bookerId,
			createdByUserId: userId,
			createdByStaffId: staffUserId ?? null,
			status,
			startsAt,
			endsAt,
			notes: notes ?? null
		})
		.returning();

	return row;
}

// ---------------------------------------------------------------------------
// confirm() — staff confirmation without payment
// ---------------------------------------------------------------------------

export async function confirm(reservationId: string): Promise<void> {
	await updateStatus(reservationId, ['scheduled'], 'confirmed');
}

// ---------------------------------------------------------------------------
// cancel()
// ---------------------------------------------------------------------------

export async function cancel(
	reservationId: string,
	userId: string,
	reason?: string,
	options?: {
		/**
		 * Staff acting on someone else's booking. Skips the ownership check AND
		 * the already-started check, and records the cancellation as staff-made.
		 */
		staffOverride?: boolean;
		/**
		 * The caller has already established that this user may cancel this
		 * booking on someone else's behalf — today, a band admin cancelling one of
		 * their own band's sessions. Deliberately narrower than `staffOverride`:
		 * it waives *only* the ownership check. A band admin still cannot cancel a
		 * session that has already started, and the cancellation is still recorded
		 * as `member` — the waitlist and notification listeners key on that, so
		 * reusing `staffOverride` here would misattribute it.
		 */
		authorizedActor?: boolean;
	}
): Promise<void> {
	// Read current state to check authorization and determine refund eligibility
	const [row] = await db
		.select()
		.from(reservation)
		.where(eq(reservation.id, reservationId))
		.limit(1);

	if (!row) {
		throw new ReservationNotFoundError();
	}

	if (!options?.staffOverride && !options?.authorizedActor && row.createdByUserId !== userId) {
		throw new ReservationAuthorizationError('Not authorized to cancel this reservation');
	}

	const status = row.status as ReservationStatus;

	if (status === 'cancelled' || status === 'completed' || status === 'no_show') {
		throw new ReservationStateError(`Cannot cancel a reservation with status "${status}"`);
	}

	if (!options?.staffOverride && row.startsAt.getTime() <= Date.now()) {
		throw new ReservationStateError('Cannot cancel a reservation that has already started');
	}

	// Atomic conditional update — only cancels if status hasn't changed since read
	const cancellable: ReservationStatus[] = ['scheduled', 'confirmed', 'waitlisted'];
	const result = await db
		.update(reservation)
		.set({
			status: 'cancelled',
			cancellationReason: reason ?? null,
			// Clear the credit-commit marker: credits are reversed below, so a stale
			// cashDueCents/creditsUsed must not survive into any later path
			// (commitReservationCredits treats non-null cashDueCents as committed).
			cashDueCents: null,
			creditsUsed: null,
			updatedAt: new Date()
		})
		.where(and(eq(reservation.id, reservationId), inArray(reservation.status, cancellable)));

	if (getRowCount(result) === 0) {
		throw new ReservationStateError('Reservation status changed concurrently');
	}

	// If a payment was recorded, refund it (Stripe-side). Credits committed to the
	// reservation live in the ledger (not the payment record breakdown), so reverse
	// them separately — this also covers cash-owed confirms that have credits
	// committed but no payment record yet. Both paths are idempotent / no-ops when
	// nothing applies (`refund()` returns early on an already-refunded payment).
	let refundError: unknown;
	if (row.stripePaymentRecordId) {
		try {
			await refund({
				// Owner, not the canceller: any checkout credits_breakdown reversal must
				// credit the member who paid (the canceller may be staff or the cron).
				userId: row.createdByUserId,
				stripePaymentRecordId: row.stripePaymentRecordId
			});
			await db
				.update(reservation)
				.set({ refundedAt: new Date() })
				.where(eq(reservation.id, reservationId));
		} catch (err) {
			// The row is already `cancelled` at this point and the status guard
			// above rejects a retry, so throwing here left it stranded: credits
			// never reversed, no `reservation.cancelled` event, so no waitlist
			// promotion and no cancellation email (JAVASCRIPT-SVELTEKIT-29).
			// Finish the cancellation, then surface the refund failure.
			refundError = err;
		}
	}
	await reverseReservationCredits(row.createdByUserId, reservationId);

	// Emit cancellation event (enables waitlist promotion)
	const TZ = DEFAULT_TIMEZONE;
	const [cancelledUser] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, row.createdByUserId))
		.limit(1);

	await domainEvents.emit('reservation.cancelled', {
		reservationId,
		userId: row.createdByUserId,
		userName: cancelledUser?.name ?? '',
		userEmail: cancelledUser?.email ?? '',
		date: formatDateInTz(row.startsAt, TZ),
		startTime: formatTimeInTz(row.startsAt, TZ),
		endTime: formatTimeInTz(row.endsAt, TZ),
		cancelledBy: options?.staffOverride ? 'staff' : 'member'
	});

	// Cancellation is complete and consistent; the refund is not. Surface it so
	// staff can follow up rather than silently keeping the member's money.
	if (refundError) throw refundError;
}

// ---------------------------------------------------------------------------
// cancelUnconfirmedReservations — release slots never confirmed by their start
// ---------------------------------------------------------------------------

/**
 * Cancel every `scheduled` reservation whose start time has passed without being
 * confirmed, freeing the slot. Members must confirm within the confirmation
 * window (or prepay via Stripe); anything still `scheduled` at start was never
 * committed. Space booked for an event is excluded: it is staff-held, has no
 * member confirm/pay flow, and releasing it at showtime handed a live event's
 * room to the waitlist. Delegates to `cancel()` with `staffOverride` so the already-started
 * guard is bypassed and any refund/credit reversal runs idempotently (a still-
 * scheduled reservation has neither, so they are no-ops). The emitted
 * `reservation.cancelled` event cascades waitlist promotion for the freed slot.
 */
export async function cancelUnconfirmedReservations(
	now: Date = new Date()
): Promise<{ cancelled: number; errors: string[] }> {
	const errors: string[] = [];
	const rows = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				eq(reservation.status, 'scheduled'),
				lt(reservation.startsAt, now),
				ne(reservation.bookerType, 'event')
			)
		);

	let cancelled = 0;
	for (const row of rows) {
		try {
			await cancel(row.id, '', 'Not confirmed before start', { staffOverride: true });
			cancelled++;
		} catch (err) {
			const msg = `Failed to auto-cancel unconfirmed reservation ${row.id}: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
		}
	}

	return { cancelled, errors };
}

// ---------------------------------------------------------------------------
// Staff resolution actions
// ---------------------------------------------------------------------------

export async function markComplete(reservationId: string): Promise<void> {
	await updateStatus(reservationId, ['confirmed'], 'completed');
}

export async function markNoShow(reservationId: string): Promise<void> {
	await updateStatus(reservationId, ['confirmed', 'scheduled'], 'no_show');
}

/**
 * Staff records cash payment for a scheduled or confirmed (cash-owed) reservation
 * and completes it in one action. Returns the Stripe payment record ID for
 * bookkeeping.
 */
export async function recordCashAndComplete(
	reservationId: string,
	stripePaymentRecordId: string
): Promise<void> {
	const result = await db
		.update(reservation)
		.set({
			status: 'completed',
			stripePaymentRecordId,
			paidAt: new Date(),
			cashDueCents: 0,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(reservation.id, reservationId),
				inArray(reservation.status, ['scheduled', 'confirmed'])
			)
		);

	if (getRowCount(result) === 0) {
		const [row] = await db
			.select({ status: reservation.status })
			.from(reservation)
			.where(eq(reservation.id, reservationId))
			.limit(1);

		if (!row) throw new Error('Reservation not found');
		throw new Error(`Expected status "scheduled" or "confirmed", got "${row.status}"`);
	}
}

// ---------------------------------------------------------------------------
// autoCompleteExpired() — bulk-complete paid reservations past their end time
// ---------------------------------------------------------------------------

export async function autoCompleteExpired(): Promise<number> {
	const now = new Date();
	// Auto-complete confirmed reservations past their end time that owe no cash:
	// paid (has a payment record) or comped/credit-settled (cashDueCents = 0).
	// Cash-owed reservations (cashDueCents > 0) are left for staff to collect.
	const result = await db
		.update(reservation)
		.set({ status: 'completed', updatedAt: now })
		.where(
			and(
				eq(reservation.status, 'confirmed'),
				lt(reservation.endsAt, now),
				or(isNotNull(reservation.stripePaymentRecordId), eq(reservation.cashDueCents, 0))
			)
		);
	return getRowCount(result);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateStatus(
	reservationId: string,
	expectedStatuses: ReservationStatus[],
	newStatus: ReservationStatus
): Promise<void> {
	// Atomic conditional update — avoids the select-then-update race condition
	const result = await db
		.update(reservation)
		.set({ status: newStatus, updatedAt: new Date() })
		.where(and(eq(reservation.id, reservationId), inArray(reservation.status, expectedStatuses)));

	if (getRowCount(result) === 0) {
		// Determine whether it's "not found" or "wrong status"
		const [row] = await db
			.select({ status: reservation.status })
			.from(reservation)
			.where(eq(reservation.id, reservationId))
			.limit(1);

		if (!row) throw new Error('Reservation not found');
		throw new Error(`Cannot transition from "${row.status}" to "${newStatus}"`);
	}
}

// ---------------------------------------------------------------------------
// listForMember — one member's bookings, for the staff user record
// ---------------------------------------------------------------------------

export interface MemberReservation {
	id: string;
	startsAt: Date;
	endsAt: Date;
	status: ReservationStatus;
	bookerType: BookerType;
	bookerId: string;
	bandName: string | null;
	cashDueCents: number | null;
	paidAt: Date | null;
	/** The staff-entered reason, which is the whole point of keeping cancelled
	 *  rows in this list — a status of "cancelled" on its own answers nothing. */
	cancellationReason: string | null;
	/** True when the member booked it themselves; false when it came via a band. */
	own: boolean;
}

export interface MemberReservations {
	upcoming: MemberReservation[];
	past: MemberReservation[];
	counts: { upcoming: number; past: number; unpaid: number; cancelledUpcoming: number };
}

/**
 * A member's bookings split around now, plus counts of the whole set.
 *
 * Two things make this wider than `eq(createdByUserId, …)`:
 *
 * - **Band bookings count.** A member whose band books the room has no
 *   `createdByUserId` row of their own, and "can you add me to my band's
 *   booking?" is one of the questions this page exists to answer. Resolved
 *   through active `bandMember` rows, the same way `getMemberDashboard` does.
 * - **Cancellations are kept.** Filtering them out would defeat the card —
 *   "why was my booking cancelled?" is unanswerable from a list that hides it.
 *
 * Event bookings are excluded: space a staff member took for a venue event is
 * the venue's, not the member's, and it has no member-facing flow at all.
 */
export async function listForMember(
	userId: string,
	options: { upcomingLimit?: number; pastLimit?: number } = {}
): Promise<MemberReservations> {
	const upcomingLimit = options.upcomingLimit ?? 5;
	const pastLimit = options.pastLimit ?? 5;
	const now = new Date();

	const bands = await db
		.select({ bandId: bandMember.bandId, bandName: band.name })
		.from(bandMember)
		.innerJoin(band, eq(band.id, bandMember.bandId))
		.where(and(eq(bandMember.userId, userId), eq(bandMember.status, 'active')));

	const bandNameById = new Map(bands.map((b) => [b.bandId, b.bandName]));
	const bandIds = bands.map((b) => b.bandId);

	// "Theirs" = booked by them, or booked by a band they are actively in.
	const mine = eq(reservation.createdByUserId, userId);
	const theirs =
		bandIds.length > 0
			? or(mine, and(eq(reservation.bookerType, 'band'), inArray(reservation.bookerId, bandIds)))!
			: mine;
	const scope = and(theirs, ne(reservation.bookerType, 'event'))!;

	const columns = {
		id: reservation.id,
		startsAt: reservation.startsAt,
		endsAt: reservation.endsAt,
		status: reservation.status,
		bookerType: reservation.bookerType,
		bookerId: reservation.bookerId,
		cashDueCents: reservation.cashDueCents,
		paidAt: reservation.paidAt,
		cancellationReason: reservation.cancellationReason,
		createdByUserId: reservation.createdByUserId
	};

	const [upcomingRows, pastRows, upcomingCount, pastCount, unpaidCount, cancelledUpcomingCount] =
		await Promise.all([
			db
				.select(columns)
				.from(reservation)
				.where(and(scope, gte(reservation.endsAt, now)))
				.orderBy(asc(reservation.startsAt))
				.limit(upcomingLimit),
			db
				.select(columns)
				.from(reservation)
				.where(and(scope, lt(reservation.endsAt, now)))
				.orderBy(desc(reservation.startsAt))
				.limit(pastLimit),
			db
				.select({ count: count() })
				.from(reservation)
				.where(and(scope, gte(reservation.endsAt, now))),
			db
				.select({ count: count() })
				.from(reservation)
				.where(and(scope, lt(reservation.endsAt, now))),
			db
				.select({ count: count() })
				.from(reservation)
				.where(
					and(
						scope,
						ne(reservation.status, 'cancelled'),
						gt(reservation.cashDueCents, 0),
						isNull(reservation.paidAt)
					)
				),
			db
				.select({ count: count() })
				.from(reservation)
				.where(and(scope, gte(reservation.endsAt, now), eq(reservation.status, 'cancelled')))
		]);

	const shape = (r: (typeof upcomingRows)[number]): MemberReservation => ({
		id: r.id,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		status: r.status,
		bookerType: r.bookerType,
		bookerId: r.bookerId,
		bandName: r.bookerType === 'band' ? (bandNameById.get(r.bookerId) ?? null) : null,
		cashDueCents: r.cashDueCents,
		paidAt: r.paidAt,
		cancellationReason: r.cancellationReason,
		own: r.createdByUserId === userId
	});

	return {
		upcoming: upcomingRows.map(shape),
		past: pastRows.map(shape),
		counts: {
			upcoming: upcomingCount[0]?.count ?? 0,
			past: pastCount[0]?.count ?? 0,
			unpaid: unpaidCount[0]?.count ?? 0,
			cancelledUpcoming: cancelledUpcomingCount[0]?.count ?? 0
		}
	};
}
