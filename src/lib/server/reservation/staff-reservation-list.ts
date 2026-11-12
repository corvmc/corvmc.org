import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	notInArray,
	or
} from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/sqlite-core';
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
import { DEFAULT_TIMEZONE, eventHoldBookers, type BookerType } from '#lib/config.js';
import type { Pagination } from '#lib/types/pagination.js';
import { bandBookerJoin, eventBookerJoin } from './event-hold.js';
import { isFirstReservationSql } from './reservation-service.js';
import { buildDateInTz, formatDateInTz } from './timezone.js';
import {
	closuresInWindow,
	interleave,
	type ClosureFilters,
	type ClosureRow,
	type ListOrder
} from './closure-timeline.js';

/** The staff Practice space list (#2586): one row of filters over bookings and closures. */

export const staffDateRanges = ['from_today', 'next_7', 'past_30', 'any', 'custom'] as const;
export type StaffDateRange = (typeof staffDateRanges)[number];

export const staffStatusViews = ['confirmed', 'payment_due', 'waitlisted', 'cancelled'] as const;
export type StaffStatusView = (typeof staffStatusViews)[number];

export interface StaffListFilters {
	search?: string;
	bookerType?: BookerType;
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

/**
 * Confirmed, not paid, and owing something: a null `cashDueCents` was never
 * priced, so it is owed in full. Event holds are never charged. The SQL twin of
 * `owesMoney` in `reservation-actions`; the spec holds the two together.
 */
export function confirmedUnpaidSql() {
	return and(
		eq(reservation.status, 'confirmed'),
		isNull(reservation.paidAt),
		isNull(reservation.refundedAt),
		or(isNull(reservation.cashDueCents), gt(reservation.cashDueCents, 0)),
		notInArray(reservation.bookerType, [...eventHoldBookers])
	);
}

function statusCondition(status: StaffStatusView) {
	return status === 'payment_due' ? confirmedUnpaidSql() : eq(reservation.status, status);
}

/** Everything but status, over `reservation` joined to its booker as the list joins it. */
function baseConditions(f: StaffListFilters, bounds: RangeBounds) {
	const conditions = [];
	if (bounds.endsAfter) conditions.push(gt(reservation.endsAt, bounds.endsAfter));
	if (bounds.from) conditions.push(gte(reservation.startsAt, bounds.from));
	if (bounds.before) conditions.push(lt(reservation.startsAt, bounds.before));
	if (f.bookerType) conditions.push(eq(reservation.bookerType, f.bookerType));
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

function listWhere(f: StaffListFilters, bounds: RangeBounds) {
	const conditions = baseConditions(f, bounds);
	if (f.status) conditions.push(statusCondition(f.status));
	return conditions.length > 0 ? and(...conditions) : undefined;
}

function joined<T extends SelectedFields>(columns: T) {
	return db
		.select(columns)
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.leftJoin(group, bandBookerJoin())
		.leftJoin(eventListing, eventBookerJoin());
}

async function reservationPage(f: StaffListFilters, bounds: RangeBounds) {
	const where = listWhere(f, bounds);
	const order = bounds.order === 'asc' ? asc(reservation.startsAt) : desc(reservation.startsAt);
	const dataQ = joined({
		id: reservation.id,
		status: reservation.status,
		startsAt: reservation.startsAt,
		endsAt: reservation.endsAt,
		bookerType: reservation.bookerType,
		notes: reservation.notes,
		stripePaymentRecordId: reservation.stripePaymentRecordId,
		paidAt: reservation.paidAt,
		// `reservationPaymentState` takes this as a required field, so a query
		// that forgets it cannot compile.
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
		.where(where)
		.orderBy(order)
		.$dynamic();
	const countQ = joined({ count: count() }).where(where);

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
async function nextPageStart(f: StaffListFilters, bounds: RangeBounds) {
	const [row] = await joined({ startsAt: reservation.startsAt })
		.where(listWhere(f, bounds))
		.orderBy(bounds.order === 'asc' ? asc(reservation.startsAt) : desc(reservation.startsAt))
		.limit(1)
		.offset((f.page ?? 1) * STAFF_LIST_PAGE_SIZE);
	return row?.startsAt;
}

export type StaffReservationRow = Awaited<ReturnType<typeof reservationPage>>['rows'][number];
export type StaffListRow = StaffReservationRow | ClosureRow;

/**
 * One page of the list. A closure has no booker and no status, so it shows only
 * under All bookers and All statuses.
 */
export async function listStaffReservations(
	f: StaffListFilters,
	now: Date
): Promise<{ rows: StaffListRow[]; pagination: Pagination }> {
	const bounds = rangeBounds(f, now);
	const page = await reservationPage(f, bounds);
	const p = page.pagination.page;
	if (f.bookerType || f.status || (p > 1 && page.rows.length === 0)) return page;
	const closureFilters: ClosureFilters = {
		endsAfter: bounds.endsAfter,
		from: bounds.from,
		before: bounds.before,
		search: f.search
	};
	const closures = await closuresInWindow(closureFilters, bounds.order, {
		first: p > 1 ? page.rows[0].startsAt : undefined,
		next: p < page.pagination.totalPages ? await nextPageStart(f, bounds) : undefined
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
	const base = baseConditions(f, rangeBounds(f, now));
	const anyDate = baseConditions(f, rangeBounds({ range: 'any' }, now));
	const plain = staffStatusViews.filter((s) => s !== 'payment_due');
	const [byStatus, [due]] = await Promise.all([
		joined({ status: reservation.status, count: count() })
			.where(and(...base, inArray(reservation.status, plain)))
			.groupBy(reservation.status),
		joined({ count: count() }).where(and(...anyDate, confirmedUnpaidSql()))
	]);
	const counts = { confirmed: 0, payment_due: due?.count ?? 0, waitlisted: 0, cancelled: 0 };
	for (const row of byStatus) counts[row.status as StaffStatusView] = row.count;
	return counts;
}

/** Sessions that have ended still owing money: the dot on the Status filter. */
export async function countOwedAfterSession(now: Date): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(reservation)
		.where(and(lt(reservation.endsAt, now), confirmedUnpaidSql()));
	return row?.count ?? 0;
}
