export type ReservationActionKey =
	| 'confirm'
	| 'cashReceived'
	| 'comp'
	| 'complete'
	| 'noShow'
	| 'cancel'
	| 'refundAndCancel'
	| 'refundOnly';

export type ReservationPaymentState =
	'paid' | 'cash_due' | 'unpaid' | 'credits' | 'comped' | 'cancelled' | 'refunded' | 'no_show';

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

/**
 * Derive a reservation's payment state for display. Order matters:
 * refunded → cancelled → paidAt (cash/online) → cash owed → not-yet-settled →
 * credit-settled → comped.
 * Credit-settled and comped share `paidAt null & cashDueCents 0`; `creditsUsed`
 * is what distinguishes them. A null `cashDueCents` means credits were never
 * committed (plain scheduled, or a staff-created confirm) — that's `unpaid`,
 * never `comped`.
 */
export function reservationPaymentState(r: {
	status: string;
	paidAt?: Date | null;
	cashDueCents?: number | null;
	creditsUsed?: number | null;
	/**
	 * Required, unlike its neighbours, and that is the point: a query that
	 * forgets to select it would otherwise report every refunded booking as a
	 * plain cancellation with nothing to catch it. `stripePaymentRecordId` used
	 * to be read here and is gone from the shape rather than left as a field
	 * nothing uses.
	 */
	refundedAt: Date | null;
}): ReservationPaymentState {
	if (r.status === 'no_show') return 'no_show';
	// `refundedAt`, not "was there ever a payment" (#573): having been charged is
	// not evidence of having been repaid, and `reservation-service` writes the
	// column inside the try around `refund()`, so a refund that threw leaves a
	// payment record and no refund. Read above `paidAt` and above the status
	// check, because "Refund only" leaves a booking standing with its `paidAt`
	// intact and money that has gone back must never read as Paid (#669).
	if (r.refundedAt) return 'refunded';
	if (r.status === 'cancelled') return 'cancelled';
	if (r.paidAt) return 'paid';
	if ((r.cashDueCents ?? 0) > 0) return 'cash_due';
	if (r.cashDueCents == null) return 'unpaid';
	if ((r.creditsUsed ?? 0) > 0) return 'credits';
	return 'comped';
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

	if (status === 'scheduled') {
		actions.add('confirm');
		actions.add('cashReceived');
		actions.add('comp');
		actions.add('cancel');
		if (now >= start) actions.add('noShow');
	}

	if (status === 'confirmed') {
		actions.add('cancel');
		if (now >= end) actions.add('complete');
		if (now >= start) actions.add('noShow');
		// Credits committed at Confirm, cash still owed → staff can record cash.
		if (cashOwed) actions.add('cashReceived');
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
