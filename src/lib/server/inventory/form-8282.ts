/**
 * The Form 8282 obligation, as a pure rule.
 *
 * When a charity disposes of donated property within three years of receiving
 * it, the IRS requires Form 8282 filed within **125 days** of the disposal, with
 * a copy to the donor. It is easy to miss by hand — the disposal and the gift
 * can be years apart, handled by different people — and the data to spot it is
 * already in the ledger: an asset knows the acquisition it arrived on, and
 * retirement stamps a date.
 *
 * Kept free of the database and of `Date.now()` so the arithmetic can be tested
 * as a table. The date maths is the whole of the risk here: an off-by-one on
 * either window turns a real filing deadline into silence.
 *
 * **This is not tax advice, and the code does not decide anything.** Whether a
 * given disposal is reportable depends on facts the system does not hold — most
 * of all whether the donor filed a Form 8283 that CMC signed, which is what makes
 * something "charitable deduction property" in the first place. This raises a
 * flag for a human; a human resolves it.
 */

/** Three years, the window in which a disposal is reportable. */
export const FORM_8282_LOOKBACK_YEARS = 3;

/** Days after the disposal by which the form is due. */
export const FORM_8282_DUE_DAYS = 125;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Form8282State =
	/** Not a gift, or not disposed of — nothing to consider. */
	| 'not_applicable'
	/** Disposed more than three years after receipt: outside the window. */
	| 'outside_window'
	/** Reportable, and someone has recorded what happened. */
	| 'resolved'
	/** Reportable, unresolved, still inside the 125 days. */
	| 'due'
	/** Reportable, unresolved, and the 125 days have run out. */
	| 'overdue';

export interface Form8282Input {
	/** When the gift was received. Null when the asset was not donated. */
	acquiredAt: Date | null;
	/** Whether the acquisition it arrived on was a donation. */
	wasDonated: boolean;
	/** When it was retired, lost or otherwise disposed of. */
	disposedAt: Date | null;
	/** When somebody recorded the filing — or recorded that none was needed. */
	resolvedAt: Date | null;
}

export interface Form8282Status {
	state: Form8282State;
	/** The filing deadline, when one applies. */
	dueBy: Date | null;
	/**
	 * Whole days left before the deadline; negative once it has passed.
	 * Null when no deadline applies.
	 */
	daysRemaining: number | null;
}

/**
 * Whether a disposal falls inside the three-year window.
 *
 * Calendar years rather than `3 * 365` days, so a leap day cannot shift the
 * boundary by one. Anniversary-exact: a disposal on the third anniversary to the
 * millisecond is *outside* the window, matching "within three years".
 */
export function isWithinLookback(acquiredAt: Date, disposedAt: Date): boolean {
	const boundary = new Date(acquiredAt);
	boundary.setFullYear(boundary.getFullYear() + FORM_8282_LOOKBACK_YEARS);
	return disposedAt.getTime() < boundary.getTime();
}

export function form8282Status(input: Form8282Input, now: Date): Form8282Status {
	const none: Form8282Status = { state: 'not_applicable', dueBy: null, daysRemaining: null };

	if (!input.wasDonated || !input.acquiredAt || !input.disposedAt) return none;

	if (!isWithinLookback(input.acquiredAt, input.disposedAt)) {
		return { state: 'outside_window', dueBy: null, daysRemaining: null };
	}

	const dueBy = new Date(input.disposedAt.getTime() + FORM_8282_DUE_DAYS * DAY_MS);

	// Resolved still reports the deadline: the record of when it was due is worth
	// keeping next to the record that it was handled.
	if (input.resolvedAt) return { state: 'resolved', dueBy, daysRemaining: null };

	const daysRemaining = Math.ceil((dueBy.getTime() - now.getTime()) / DAY_MS);

	return {
		state: daysRemaining < 0 ? 'overdue' : 'due',
		dueBy,
		daysRemaining
	};
}

/** Whether a status needs a human to do something. */
export function needsAttention(status: Form8282Status): boolean {
	return status.state === 'due' || status.state === 'overdue';
}
