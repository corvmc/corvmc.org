/**
 * Narrowing a shift row to one that actually has a window.
 *
 * `work_order.starts_at` and `ends_at` are nullable — an unscheduled row is work
 * with no time booked yet — and every dated query drops those anyway, since
 * `NULL >= x` is NULL. Re-stated at runtime rather than asserted over, so the
 * types follow the filter. A leaf module because several services use it.
 */
export function isScheduled<T extends { startsAt: Date | null; endsAt: Date | null }>(
	row: T
): row is T & { startsAt: Date; endsAt: Date } {
	return row.startsAt !== null && row.endsAt !== null;
}
