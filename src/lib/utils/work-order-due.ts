/**
 * Due-date ordering and overdue state for undated work orders (#1966). `dueAt`
 * is a moment, not a calendar day, so overdue means that moment has passed.
 * Client-safe: no server imports.
 */

interface Due {
	dueAt: Date | null;
	createdAt: Date;
}

/** A comparator: soonest due first, no deadline last, then oldest created. */
export function byDueAt(a: Due, b: Due): number {
	if (a.dueAt && b.dueAt && a.dueAt.getTime() !== b.dueAt.getTime()) {
		return a.dueAt.getTime() - b.dueAt.getTime();
	}
	if (a.dueAt && !b.dueAt) return -1;
	if (b.dueAt && !a.dueAt) return 1;
	return a.createdAt.getTime() - b.createdAt.getTime();
}

export function isOverdue(w: { dueAt: Date | null }, now: Date): boolean {
	return w.dueAt !== null && w.dueAt.getTime() < now.getTime();
}
