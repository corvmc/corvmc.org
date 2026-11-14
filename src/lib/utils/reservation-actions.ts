import { isEventHold } from '#lib/config.js';

export type ReservationActionKey =
	'cashReceived' | 'comp' | 'complete' | 'noShow' | 'cancel' | 'refundAndCancel' | 'refundOnly';

/** Statuses that end a reservation's lifecycle (no further member actions). */
export function isTerminalStatus(status: string): boolean {
	return status === 'completed' || status === 'cancelled' || status === 'no_show';
}

export interface OverlapCandidate {
	id: string;
	startsAt: Date;
	endsAt: Date;
	status: string;
}

/**
 * Rows from `others` that double-book the current reservation's time range.
 * Cancelled and waitlisted rows don't hold the slot, and a terminal or
 * waitlisted current reservation can't be double-booked, so both report empty.
 */
export function overlappingReservations<T extends OverlapCandidate>(
	current: OverlapCandidate,
	others: T[]
): T[] {
	if (isTerminalStatus(current.status) || current.status === 'waitlisted') return [];
	return others.filter(
		(o) =>
			o.id !== current.id &&
			o.status !== 'cancelled' &&
			o.status !== 'waitlisted' &&
			o.startsAt < current.endsAt &&
			o.endsAt > current.startsAt
	);
}

export const reservationTracks = [
	'waitlisted',
	'booked',
	'paid',
	'payment_due',
	'covered',
	'no_show',
	'cancelled',
	'refunded'
] as const;
/** The one status a reservation is shown with (#2861). Derived, never stored. */
export type ReservationTrack = (typeof reservationTracks)[number];

/** The columns the track reads. All required, so a query cannot forget one. */
export interface TrackedReservation {
	status: string;
	bookerType: string;
	endsAt: Date;
	paidAt: Date | null;
	refundedAt: Date | null;
	cashDueCents: number | null;
}

/**
 * A reservation's track. `reservationTrackSql` is the same reading in SQL and
 * `reservation-track.spec.ts` holds the two together. Order matters: money that
 * went back never reads Paid, and a refund-only booking keeps its `paidAt`.
 * Payment due is `owesMoney` on a session that has ended; before that it reads
 * Booked. `completed` is not a track: a closed booking reads Paid or Covered.
 */
export function reservationTrack(r: TrackedReservation, now: Date = new Date()): ReservationTrack {
	if (r.status === 'waitlisted') return 'waitlisted';
	if (r.status === 'no_show') return 'no_show';
	if (r.refundedAt) return 'refunded';
	if (r.status === 'cancelled') return 'cancelled';
	if (r.paidAt) return 'paid';
	const ended = r.endsAt.getTime() < now.getTime();
	if (owesMoney(r)) return ended ? 'payment_due' : 'booked';
	// An event hold is never charged, so it has nothing to be covered until it ends.
	if (r.status === 'confirmed' && isEventHold(r.bookerType) && !ended) return 'booked';
	return 'covered';
}

/** What settled a Covered reservation: the detail page says which (#2861). */
export function coveredBy(r: { creditsUsed: number | null }): 'credits' | 'comp' {
	return (r.creditsUsed ?? 0) > 0 ? 'credits' : 'comp';
}

/** Tracks with no further member action: the session will not happen or is undone. */
export function isClosedTrack(track: ReservationTrack): boolean {
	return track === 'cancelled' || track === 'refunded' || track === 'no_show';
}

export function visibleActions(
	status: string,
	startsAt: Date,
	endsAt: Date,
	stripePaymentRecordId?: string | null,
	now: Date = new Date(),
	opts?: { cashDueCents?: number | null; paidAt?: Date | null; refundedAt?: Date | null }
): Set<ReservationActionKey> {
	const actions = new Set<ReservationActionKey>();
	const start = startsAt;
	const end = endsAt;
	// Owed = not paid and not settled: either committed cash due (> 0) or credits
	// never committed at all (null, e.g. staff-created confirms). Only an explicit
	// 0 (comped / credit-settled) clears the debt.
	const cashOwed = opts != null && !opts.paidAt && opts.cashDueCents !== 0;

	if (status === 'confirmed') {
		actions.add('cancel');
		if (now >= end) actions.add('complete');
		if (now >= start) actions.add('noShow');
		// Cash still owed → staff can record it or waive it.
		if (cashOwed) {
			actions.add('cashReceived');
			actions.add('comp');
		}
	}

	// Two actions, because staff intent differs: cancelling the booking, or
	// comping a session that went ahead. Once the money is back there is nothing
	// left to refund, so `refundedAt` retires both (JAVASCRIPT-SVELTEKIT-29 was
	// refund-then-cancel refunding twice). `cancel()` rejects a completed
	// booking, so only the standalone refund is offered there.
	if (stripePaymentRecordId && !opts?.refundedAt) {
		if (status === 'confirmed') actions.add('refundAndCancel');
		if (status === 'confirmed' || status === 'completed') actions.add('refundOnly');
	}

	return actions;
}

interface PayableReservation {
	status: string;
	paidAt?: Date | null;
	cashDueCents?: number | null;
}

/** Confirmed with a balance still owed; a null `cashDueCents` is owed in full. */
export function confirmedUnpaid(r: PayableReservation): boolean {
	return r.status === 'confirmed' && !r.paidAt && (r.cashDueCents == null || r.cashDueCents > 0);
}

/** What `getReservationPayment` accepts: the server's pay-page gate. */
export function isAwaitingPayment(r: PayableReservation): boolean {
	return confirmedUnpaid(r);
}

/**
 * The pay link a member's own reservation offers. A balance stays payable after
 * the session ends; the start-time gate belongs to cancel, not to money owed.
 */
export function memberPayAction(r: PayableReservation): 'balance' | null {
	return confirmedUnpaid(r) ? 'balance' : null;
}

/**
 * Owes money: confirmed and unpaid, not refunded, and not an event hold, which
 * is never charged. `confirmedUnpaidSql` in `payment-due` is the same reading
 * in SQL. The Payment due track is this on a session that has ended.
 */
export function owesMoney(
	r: PayableReservation & { bookerType: string; refundedAt: Date | null }
): boolean {
	return confirmedUnpaid(r) && !r.refundedAt && !isEventHold(r.bookerType);
}

/** A session that has ended still owing: its row offers Cash received and No-show. */
export function owedAfterSession(r: TrackedReservation, now: Date = new Date()): boolean {
	return reservationTrack(r, now) === 'payment_due';
}
