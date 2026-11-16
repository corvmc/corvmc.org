/**
 * Narrowing a shift row to one with a window and a shift id to key it by: a
 * task with two shifts gives two rows with the same task `id`. A task row's
 * times are null when it has no shift, and every dated query drops those
 * anyway. Re-stated at runtime rather than asserted over, so the types follow
 * the filter. A leaf module because several services use it.
 */
export function isScheduled<
	T extends { shiftId: string | null; startsAt: Date | null; endsAt: Date | null }
>(row: T): row is T & { shiftId: string; startsAt: Date; endsAt: Date } {
	return row.shiftId !== null && row.startsAt !== null && row.endsAt !== null;
}
