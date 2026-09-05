export type ReservationActionKey =
	'confirm' | 'cashReceived' | 'comp' | 'complete' | 'noShow' | 'cancel' | 'refund';

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
 * paidAt (cash/online) → cash owed → not-yet-settled → credit-settled → comped.
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
	stripePaymentRecordId?: string | null;
	refundedAt?: Date | null;
}): ReservationPaymentState {
	if (r.status === 'no_show') return 'no_show';
	// NOTE: infers "refunded" from "cancelled and once had a payment", so a cancel
	// whose refund failed still displays as refunded. Keying this on `refundedAt`
	// is the correct fix but needs a data check first — rows cancelled before that
	// column was populated would flip to "cancelled". See #573.
	if (r.status === 'cancelled') return r.stripePaymentRecordId ? 'refunded' : 'cancelled';
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

	// Refund does NOT cancel, so both buttons used to sit enabled side by side and
	// refund-then-cancel refunded twice (JAVASCRIPT-SVELTEKIT-29). Once the money
	// is back, there is nothing left to refund.
	if (
		stripePaymentRecordId &&
		!opts?.refundedAt &&
		(status === 'confirmed' || status === 'completed')
	) {
		actions.add('refund');
	}

	return actions;
}
