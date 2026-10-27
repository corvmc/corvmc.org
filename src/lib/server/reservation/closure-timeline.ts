import { and, asc, count, desc, gt, gte, lt, lte, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { closure } from '$lib/server/db/schema/reservation';
import { containsLiteral } from '$lib/server/db/like';
import { paginate, type PaginatedResult } from '$lib/server/db/paginate';

/**
 * Closures as rows of the staff reservations list (#1833): one timeline of
 * what the room is doing, with a closure as the other kind of booking.
 */

export interface ClosureRow {
	kind: 'closure';
	id: string;
	reason: string;
	startsAt: Date;
	endsAt: Date;
}

export type ListOrder = 'asc' | 'desc';

export interface ClosureFilters {
	/** The Upcoming tab: anything not yet over, as reservations are filtered. */
	upcomingOnly: boolean;
	from?: Date;
	to?: Date;
	search?: string;
}

/**
 * The slice of the list one page of reservations covers, in list order: from
 * this page's first row (inclusive; open on page one) to the next page's first
 * row (exclusive; open on the last page). Every closure lands on exactly one page.
 */
export interface PageWindow {
	first?: Date;
	next?: Date;
}

function conditions(f: ClosureFilters, now: Date): SQL[] {
	const out: SQL[] = [];
	if (f.upcomingOnly) out.push(gt(closure.endsAt, now));
	if (f.from) out.push(gte(closure.startsAt, f.from));
	if (f.to) out.push(lte(closure.startsAt, f.to));
	if (f.search) out.push(containsLiteral(closure.reason, f.search));
	return out;
}

const columns = {
	id: closure.id,
	reason: closure.reason,
	startsAt: closure.startsAt,
	endsAt: closure.endsAt
};

const orderBy = (order: ListOrder) =>
	order === 'asc'
		? [asc(closure.startsAt), asc(closure.id)]
		: [desc(closure.startsAt), desc(closure.id)];

const shape = (r: Omit<ClosureRow, 'kind'>): ClosureRow => ({ kind: 'closure', ...r });

export async function closuresInWindow(
	f: ClosureFilters,
	now: Date,
	order: ListOrder,
	window: PageWindow
): Promise<ClosureRow[]> {
	const where = conditions(f, now);
	if (window.first) {
		where.push(
			order === 'asc' ? gte(closure.startsAt, window.first) : lte(closure.startsAt, window.first)
		);
	}
	if (window.next) {
		where.push(
			order === 'asc' ? lt(closure.startsAt, window.next) : gt(closure.startsAt, window.next)
		);
	}
	const rows = await db
		.select(columns)
		.from(closure)
		.where(and(...where))
		.orderBy(...orderBy(order));
	return rows.map(shape);
}

/** The Closures filter: closures alone, paged like the reservations they replace. */
export async function closuresPage(
	f: ClosureFilters,
	now: Date,
	order: ListOrder,
	page: number,
	pageSize: number
): Promise<PaginatedResult<ClosureRow>> {
	const where = and(...conditions(f, now));
	const { rows, pagination } = await paginate(
		db
			.select(columns)
			.from(closure)
			.where(where)
			.orderBy(...orderBy(order))
			.$dynamic(),
		db.select({ count: count() }).from(closure).where(where),
		{ page, pageSize }
	);
	return { rows: rows.map(shape), pagination };
}

export async function countClosures(now: Date): Promise<{ upcoming: number; all: number }> {
	const [[upcoming], [all]] = await Promise.all([
		db.select({ count: count() }).from(closure).where(gt(closure.endsAt, now)),
		db.select({ count: count() }).from(closure)
	]);
	return { upcoming: upcoming?.count ?? 0, all: all?.count ?? 0 };
}

/**
 * Merges closures into an already-ordered page of rows. A closure goes ahead of
 * a booking that starts at the same moment, since it is what blocks the room.
 */
export function interleave<R extends { startsAt: Date }>(
	rows: R[],
	closures: ClosureRow[],
	order: ListOrder
): (R | ClosureRow)[] {
	const before = (c: ClosureRow, r: R) =>
		order === 'asc'
			? c.startsAt.getTime() <= r.startsAt.getTime()
			: c.startsAt.getTime() >= r.startsAt.getTime();
	const out: (R | ClosureRow)[] = [];
	let i = 0;
	for (const r of rows) {
		while (i < closures.length && before(closures[i], r)) out.push(closures[i++]);
		out.push(r);
	}
	while (i < closures.length) out.push(closures[i++]);
	return out;
}
