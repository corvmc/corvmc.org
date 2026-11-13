/**
 * Narrowing a shift row to one that actually has a window, and a shift id to
 * key it by: a task with two shifts gives two rows with the same task `id`.
 *
 * A task row's `startsAt` and `endsAt` are null when it has no shift — work
 * with no time booked yet — and every dated query drops those anyway, since
 * `NULL >= x` is NULL. Re-stated at runtime rather than asserted over, so the
 * types follow the filter. A leaf module because several services use it.
 */
export function isScheduled<
	T extends { shiftId: string | null; startsAt: Date | null; endsAt: Date | null }
>(row: T): row is T & { shiftId: string; startsAt: Date; endsAt: Date } {
	return row.shiftId !== null && row.startsAt !== null && row.endsAt !== null;
}
