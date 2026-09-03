/**
 * Narrowing a shift row to one that actually has a window.
 *
 * `work_order.starts_at` and `ends_at` became nullable when work orders
 * landed: an unscheduled row is work somebody needs to do with no time booked
 * for it yet. Every dated query drops those on its own, because `NULL >= x` is
 * NULL rather than true, so a scheduled query's rows always have both.
 *
 * This re-states that at runtime rather than asserting over it — the types then
 * follow the filter instead of contradicting it, and a query that forgets its
 * date predicate returns fewer rows instead of handing a null to a formatter.
 *
 * It lives in its own leaf module, not in `work-order-service`, because it
 * is a pure predicate that several services use: behind a mocked service every
 * spec that stubs that module would have to reimplement it, and would then be
 * testing its own copy.
 */
export function isScheduled<T extends { startsAt: Date | null; endsAt: Date | null }>(
	row: T
): row is T & { startsAt: Date; endsAt: Date } {
	return row.startsAt !== null && row.endsAt !== null;
}
