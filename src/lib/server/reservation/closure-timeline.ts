import { and, asc, count, desc, gt, gte, lt, lte, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { paginate } from '#lib/server/db/paginate.js';
import type { Pagination } from '#lib/types/pagination.js';
import { closure } from '#lib/server/db/schema/reservation.js';
import { containsLiteral } from '#lib/server/db/like.js';

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

/** The same bounds the reservations of the list are held to. */
export interface ClosureFilters {
	/** `ends_at > endsAfter`: still running or ahead. */
	endsAfter?: Date;
	/** `starts_at >= from`. */
	from?: Date;
	/** `starts_at < before`. */
	before?: Date;
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

function conditions(f: ClosureFilters): SQL[] {
	const out: SQL[] = [];
	if (f.endsAfter) out.push(gt(closure.endsAt, f.endsAfter));
	if (f.from) out.push(gte(closure.startsAt, f.from));
	if (f.before) out.push(lt(closure.startsAt, f.before));
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
	order: ListOrder,
	window: PageWindow
): Promise<ClosureRow[]> {
	const where = conditions(f);
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

/** Closures alone, a page at a time: the list's Closures type filter (#2766). */
export async function closurePage(
	f: ClosureFilters,
	order: ListOrder,
	page: number,
	pageSize: number
): Promise<{ rows: ClosureRow[]; pagination: Pagination }> {
	const where = and(...conditions(f));
	const dataQ = db
		.select(columns)
		.from(closure)
		.where(where)
		.orderBy(...orderBy(order))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(closure).where(where);
	const result = await paginate(dataQ, countQ, { page, pageSize });
	return { rows: result.rows.map(shape), pagination: result.pagination };
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

/** Closures overlapping `[from, to)`, soonest first — a day on the reservation page's timeline. */
export async function closuresOverlapping(from: Date, to: Date): Promise<ClosureRow[]> {
	const rows = await db
		.select(columns)
		.from(closure)
		.where(and(lt(closure.startsAt, to), gt(closure.endsAt, from)))
		.orderBy(...orderBy('asc'));
	return rows.map(shape);
}
