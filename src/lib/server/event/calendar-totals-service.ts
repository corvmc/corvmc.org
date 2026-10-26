import { db } from '$lib/server/db';
import { eventListing, publicEventStatuses } from '$lib/server/db/schema/event';
import { and, count, eq, gte, inArray, lt, not, or, sql, type SQL } from 'drizzle-orm';
import { buildDateInTz, formatDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { addIsoDays } from '$lib/utils/deadline';

/** Midnight tonight in venue time — the staff calendar's and the gig guide's floor. */
export const calendarFloor = (now = new Date()): Date =>
	buildDateInTz(formatDateInTz(now, DEFAULT_TIMEZONE), '00:00', DEFAULT_TIMEZONE);

/**
 * Every row the staff calendar can show: public listings from tonight on, and
 * the queue whatever its date — a stale listing is still a decision owed. A
 * community draft is its author's, never staff's.
 */
export const staffCalendarRow = (from: Date): SQL =>
	and(
		or(
			not(inArray(eventListing.status, [...publicEventStatuses])),
			gte(eventListing.startsAt, from)
		),
		not(and(eq(eventListing.source, 'community'), eq(eventListing.status, 'draft'))!)
	)!;

/** The "On the calendar" status filter. */
export const onCalendar = (): SQL => inArray(eventListing.status, [...publicEventStatuses]);

/** The "Needs review" status filter, and the sidebar badge's count. */
export const needsReview = (): SQL => eq(eventListing.status, 'pending_review');

export interface CalendarTotals {
	/** On the calendar from tonight through Sunday. */
	thisWeek: number;
	/** On the calendar from tonight through the end of the month. */
	thisMonth: number;
	/** Waiting on a staff decision, whatever the date. */
	needsReview: number;
}

const countWhere = (predicate: SQL | undefined) => count(sql`case when ${predicate} then 1 end`);

/** Venue-time boundaries for "this week" (Mon–Sun) and "this month", from tonight. */
export function calendarWindows(now = new Date()) {
	const today = formatDateInTz(now, DEFAULT_TIMEZONE);
	const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
	const nextMonday = addIsoDays(today, dow === 0 ? 1 : 8 - dow);
	const [y, m] = today.split('-').map(Number);
	const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
	return {
		from: calendarFloor(now),
		weekEnd: buildDateInTz(nextMonday, '00:00', DEFAULT_TIMEZONE),
		monthEnd: buildDateInTz(nextMonth, '00:00', DEFAULT_TIMEZONE)
	};
}

/** The Calendar page's summary counts in one scan; blind to the table's filters. */
export async function getCalendarTotals(now = new Date()): Promise<CalendarTotals> {
	const { from, weekEnd, monthEnd } = calendarWindows(now);
	const [row] = await db
		.select({
			thisWeek: countWhere(and(onCalendar(), lt(eventListing.startsAt, weekEnd))),
			thisMonth: countWhere(and(onCalendar(), lt(eventListing.startsAt, monthEnd))),
			needsReview: countWhere(needsReview())
		})
		.from(eventListing)
		.where(staffCalendarRow(from));
	return row ?? { thisWeek: 0, thisMonth: 0, needsReview: 0 };
}
