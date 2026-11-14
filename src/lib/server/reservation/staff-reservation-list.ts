import { and, asc, count, desc, eq, gt, gte, lt, or } from 'drizzle-orm';
import { parseDate } from '@internationalized/date';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { group } from '#lib/server/db/schema/group.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { containsLiteral } from '#lib/server/db/like.js';
import { paginate } from '#lib/server/db/paginate.js';
import {
	bandRefColumns,
	eventRefColumns,
	memberRefColumns,
	toBookerRef
} from '#lib/server/entity/refs.js';
import { bookerTypes, DEFAULT_TIMEZONE } from '#lib/config.js';
import type { Pagination } from '#lib/types/pagination.js';
import { bandBookerJoin, eventBookerJoin } from './event-hold.js';
import { paymentDueSql, reservationTrackSql } from './payment-due.js';
import { reservationTracks, type ReservationTrack } from '#lib/utils/reservation-actions.js';
import { isFirstReservationSql } from './reservation-service.js';
import { buildDateInTz, formatDateInTz } from './timezone.js';

import {
	closurePage,
	closuresInWindow,
	interleave,
	type ClosureFilters,
	type ClosureRow,
	type ListOrder
} from './closure-timeline.js';

/** The staff Practice space list (#2586): one row of filters over bookings and closures. */

export const staffDateRanges = ['from_today', 'next_7', 'past_30', 'any', 'custom'] as const;
export type StaffDateRange = (typeof staffDateRanges)[number];

/** The status filter offers the track (#2861); nothing filters by the stored status. */
export const staffStatusViews = reservationTracks;
export type StaffStatusView = ReservationTrack;

/** The list's type filter: a booker type, or closures alone (#2766). */
export const staffListTypes = [...bookerTypes, 'closure'] as const;
export type StaffListType = (typeof staffListTypes)[number];

export interface StaffListFilters {
	search?: string;
	bookerType?: StaffListType;
	range?: StaffDateRange;
	/** `YYYY-MM-DD`, club time; read only when `range` is `custom`. */
	dateFrom?: string;
	dateTo?: string;
	status?: StaffStatusView;
	page?: number;
}

export const STAFF_LIST_PAGE_SIZE = 50;

export interface RangeBounds {
	/** Only rows still running or ahead: `ends_at > endsAfter`. */
	endsAfter?: Date;
	/** `starts_at >= from`. */
	from?: Date;
	/** `starts_at < before`. */
	before?: Date;
	order: ListOrder;
}

function shiftDay(day: string, days: number): string {
	return parseDate(day).add({ days }).toString();
}

const midnight = (day: string) => buildDateInTz(day, '00:00', DEFAULT_TIMEZONE);

/**
 * A date preset as instants. Forward-looking ranges list soonest first; Past 30
 * days and Any date list newest first, as the old All tab did.
 */
export function rangeBounds(
	f: Pick<StaffListFilters, 'range' | 'dateFrom' | 'dateTo'>,
	now: Date
): RangeBounds {
	const today = formatDateInTz(now, DEFAULT_TIMEZONE);
	switch (f.range ?? 'from_today') {
		case 'from_today':
			return { endsAfter: now, order: 'asc' };
		case 'next_7':
			return { endsAfter: now, before: midnight(shiftDay(today, 7)), order: 'asc' };
		case 'past_30':
			return { from: midnight(shiftDay(today, -29)), before: now, order: 'desc' };
		case 'any':
			return { order: 'desc' };
		case 'custom':
			return {
				from: f.dateFrom ? midnight(f.dateFrom) : undefined,
				before: f.dateTo ? midnight(shiftDay(f.dateTo, 1)) : undefined,
				order: 'asc'
			};
	}
}

function statusCondition(status: StaffStatusView, now: Date) {
	return status === 'payment_due' ? paymentDueSql(now) : eq(reservationTrackSql(now), status);
}

/** Everything but status, over `reservation` joined to its booker as the list joins it. */
function baseConditions(f: StaffListFilters, bounds: RangeBounds) {
	const conditions = [];
	if (bounds.endsAfter) conditions.push(gt(reservation.endsAt, bounds.endsAfter));
	if (bounds.from) conditions.push(gte(reservation.startsAt, bounds.from));
	if (bounds.before) conditions.push(lt(reservation.startsAt, bounds.before));
	if (f.bookerType && f.bookerType !== 'closure') {
		conditions.push(eq(reservation.bookerType, f.bookerType));
	}
	if (f.search) {
		conditions.push(
			or(
				containsLiteral(user.name, f.search),
				containsLiteral(user.email, f.search),
				containsLiteral(group.name, f.search),
				containsLiteral(eventListing.title, f.search)
			)
		);
	}
	return conditions;
}

function listWhere(f: StaffListFilters, bounds: RangeBounds, now: Date) {
	const conditions = baseConditions(f, bounds);
	if (f.status) conditions.push(statusCondition(f.status, now));
	return conditions.length > 0 ? and(...conditions) : undefined;
}

async function reservationPage(f: StaffListFilters, bounds: RangeBounds, now: Date) {
	const where = listWhere(f, bounds, now);
	const order = bounds.order === 'asc' ? asc(reservation.startsAt) : desc(reservation.startsAt);
	const dataQ = db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			bookerType: reservation.bookerType,
			notes: reservation.notes,
			stripePaymentRecordId: reservation.stripePaymentRecordId,
			paidAt: reservation.paidAt,
			// `reservationTrack` requires every column it reads, so a query that
			// forgets one cannot compile.
			refundedAt: reservation.refundedAt,
			cashDueCents: reservation.cashDueCents,
			creditsUsed: reservation.creditsUsed,
			createdByUserId: reservation.createdByUserId,
			recurringSeriesId: reservation.recurringSeriesId,
			// The desk staffs a volunteer for a member's first visit.
			isFirstReservation: isFirstReservationSql(),
			member: memberRefColumns(),
			band: bandRefColumns(),
			event: eventRefColumns()
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(group, bandBookerJoin())
		.leftJoin(eventListing, eventBookerJoin())
		.where(where)
		.orderBy(order)
		.$dynamic();
	const countQ = db
		.select({ count: count() })
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(group, bandBookerJoin())
		.leftJoin(eventListing, eventBookerJoin())
		.where(where);

	const { rows, pagination } = await paginate(dataQ, countQ, {
		page: f.page ?? 1,
		pageSize: STAFF_LIST_PAGE_SIZE
	});
	return {
		rows: rows.map(({ member, band, event, ...r }) => ({
			...r,
			kind: 'reservation' as const,
			// SQLite has no booleans: the subquery lands as 0 or 1.
			isFirstReservation: !!r.isFirstReservation,
			booker: toBookerRef({ bookerType: r.bookerType, member, band, event })
		})),
		pagination
	};
}

/** Where the next page starts, so a page knows which closures are its own. */
async function nextPageStart(f: StaffListFilters, bounds: RangeBounds, now: Date) {
	const [row] = await db
		.select({ startsAt: reservation.startsAt })
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(group, bandBookerJoin())
		.leftJoin(eventListing, eventBookerJoin())
		.where(listWhere(f, bounds, now))
		.orderBy(bounds.order === 'asc' ? asc(reservation.startsAt) : desc(reservation.startsAt))
		.limit(1)
		.offset((f.page ?? 1) * STAFF_LIST_PAGE_SIZE);
	return row?.startsAt;
}

export type StaffReservationRow = Awaited<ReturnType<typeof reservationPage>>['rows'][number];
export type StaffListRow = StaffReservationRow | ClosureRow;

/**
 * One page of the list. A closure has no booker and no status, so it shows only
 * under All bookers or Closures, and All statuses.
 */
export async function listStaffReservations(
	f: StaffListFilters,
	now: Date
): Promise<{ rows: StaffListRow[]; pagination: Pagination }> {
	const bounds = rangeBounds(f, now);
	const closureFilters: ClosureFilters = {
		endsAfter: bounds.endsAfter,
		from: bounds.from,
		before: bounds.before,
		search: f.search
	};
	if (f.bookerType === 'closure') {
		const empty = {
			rows: [],
			pagination: { page: 1, pageSize: STAFF_LIST_PAGE_SIZE, total: 0, totalPages: 0 }
		};
		if (f.status) return empty;
		return closurePage(closureFilters, bounds.order, f.page ?? 1, STAFF_LIST_PAGE_SIZE);
	}
	const page = await reservationPage(f, bounds, now);
	const p = page.pagination.page;
	if (f.bookerType || f.status || (p > 1 && page.rows.length === 0)) return page;
	const closures = await closuresInWindow(closureFilters, bounds.order, {
		first: p > 1 ? page.rows[0].startsAt : undefined,
		next: p < page.pagination.totalPages ? await nextPageStart(f, bounds, now) : undefined
	});
	return { ...page, rows: interleave(page.rows, closures, bounds.order) };
}

/**
 * What each status option would list with the other filters as they are.
 * Payment due is counted over any date, because choosing it widens the date.
 */
export async function countStaffStatuses(
	f: StaffListFilters,
	now: Date
): Promise<Record<StaffStatusView, number>> {
	const counts = Object.fromEntries(staffStatusViews.map((s) => [s, 0])) as Record<
		StaffStatusView,
		number
	>;
	if (f.bookerType === 'closure') return counts;
	const track = reservationTrackSql(now);
	const tally = (conditions: ReturnType<typeof baseConditions>) =>
		db
			.select({ track, count: count() })
			.from(reservation)
			.innerJoin(user, eq(reservation.createdByUserId, user.id))
			.leftJoin(group, bandBookerJoin())
			.leftJoin(eventListing, eventBookerJoin())
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.groupBy(track);
	const [inRange, anyDate] = await Promise.all([
		tally(baseConditions(f, rangeBounds(f, now))),
		tally(baseConditions(f, rangeBounds({ range: 'any' }, now)))
	]);
	for (const row of inRange) counts[row.track] = row.count;
	counts.payment_due = anyDate.find((row) => row.track === 'payment_due')?.count ?? 0;
	return counts;
}

/** Sessions that have ended still owing money: the dot on the Status filter. */
export async function countOwedAfterSession(now: Date): Promise<number> {
	const [row] = await db.select({ count: count() }).from(reservation).where(paymentDueSql(now));
	return row?.count ?? 0;
}
