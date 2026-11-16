import { and, asc, count, desc, eq, getTableColumns, gte, lt, or, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { eventListing, eventStatuses, type EventStatus } from '#lib/server/db/schema/event.js';
import { group } from '#lib/server/db/schema/group.js';
import { venue } from '#lib/server/db/schema/venue.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { containsLiteral } from '#lib/server/db/like.js';
import { paginate } from '#lib/server/db/paginate.js';
import { memberRefColumns } from '#lib/server/entity/refs.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import { clubToday, DEFAULT_TIMEZONE, type EventSource, type ListDateRange } from '#lib/config.js';
import { addIsoDays } from '#lib/utils/deadline.js';
import { staffVisible } from './calendar-totals-service';

/** The staff Events list (#2632): the Practice space list's filter row over listings. */

export interface StaffCalendarFilters {
	source?: EventSource;
	/** Title, band name or venue. */
	q?: string;
	range?: ListDateRange;
	/** `YYYY-MM-DD`, club time; read only when `range` is `custom`. */
	from?: string;
	to?: string;
	status?: EventStatus;
	page?: number;
}

export const STAFF_CALENDAR_PAGE_SIZE = 50;

interface Bounds {
	/** `starts_at >= from`. */
	from?: Date;
	/** `starts_at < before`. */
	before?: Date;
	order: 'asc' | 'desc';
}

const midnight = (day: string) => buildDateInTz(day, '00:00', DEFAULT_TIMEZONE);

/**
 * A date preset as instants, by club calendar day. Everything lists soonest
 * first except Past 30 days, which puts the most recent event on top.
 */
export function staffCalendarBounds(
	f: Pick<StaffCalendarFilters, 'range' | 'from' | 'to'>,
	now: Date
): Bounds {
	const today = clubToday(now);
	switch (f.range ?? 'from_today') {
		case 'from_today':
			return { from: midnight(today), order: 'asc' };
		case 'next_7':
			return { from: midnight(today), before: midnight(addIsoDays(today, 7)), order: 'asc' };
		case 'past_30':
			return { from: midnight(addIsoDays(today, -29)), before: now, order: 'desc' };
		case 'any':
			return { order: 'asc' };
		case 'custom':
			return {
				from: f.from ? midnight(f.from) : undefined,
				before: f.to ? midnight(addIsoDays(f.to, 1)) : undefined,
				order: 'asc'
			};
	}
}

/** Everything but status, over `event_listing` joined to its band and venue. */
function baseConditions(f: StaffCalendarFilters, bounds: Bounds): SQL[] {
	const conditions: SQL[] = [staffVisible()];
	if (bounds.from) conditions.push(gte(eventListing.startsAt, bounds.from));
	if (bounds.before) conditions.push(lt(eventListing.startsAt, bounds.before));
	if (f.source) conditions.push(eq(eventListing.source, f.source));
	if (f.q) {
		conditions.push(
			or(
				containsLiteral(eventListing.title, f.q),
				containsLiteral(group.name, f.q),
				containsLiteral(venue.name, f.q),
				containsLiteral(eventListing.location, f.q)
			)!
		);
	}
	return conditions;
}

/**
 * One page of the list, and what each status option would list with the other
 * filters as they are.
 */
export async function listStaffCalendar(f: StaffCalendarFilters = {}, now = new Date()) {
	const bounds = staffCalendarBounds(f, now);
	const base = baseConditions(f, bounds);
	const where = and(...base, f.status ? eq(eventListing.status, f.status) : undefined);
	const order = bounds.order === 'asc' ? asc(eventListing.startsAt) : desc(eventListing.startsAt);

	const dataQ = db
		.select({
			...getTableColumns(eventListing),
			bandName: group.name,
			bandSlug: group.slug,
			// Left, so a deleted account does not take the event off the list.
			submitter: memberRefColumns()
		})
		.from(eventListing)
		.leftJoin(group, eq(group.id, eventListing.groupId))
		.leftJoin(venue, eq(venue.id, eventListing.venueId))
		.leftJoin(user, eq(user.id, eventListing.createdByUserId))
		.where(where)
		// `id` breaks a tie, so two shows at one time keep their order across pages.
		.orderBy(order, asc(eventListing.id))
		.$dynamic();
	const countQ = db
		.select({ count: count() })
		.from(eventListing)
		.leftJoin(group, eq(group.id, eventListing.groupId))
		.leftJoin(venue, eq(venue.id, eventListing.venueId))
		.where(where);

	const [page, byStatus] = await Promise.all([
		paginate(dataQ, countQ, { page: f.page ?? 1, pageSize: STAFF_CALENDAR_PAGE_SIZE }),
		db
			.select({ status: eventListing.status, count: count() })
			.from(eventListing)
			.leftJoin(group, eq(group.id, eventListing.groupId))
			.leftJoin(venue, eq(venue.id, eventListing.venueId))
			.where(and(...base))
			.groupBy(eventListing.status)
	]);

	const statusCounts = Object.fromEntries(eventStatuses.map((s) => [s, 0])) as Record<
		EventStatus,
		number
	>;
	for (const r of byStatus) statusCounts[r.status] = r.count;
	return { ...page, statusCounts };
}
