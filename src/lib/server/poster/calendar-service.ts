import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { group } from '#lib/server/db/schema/group.js';
import { and, asc, eq, gte, isNull, lt, ne, or } from 'drizzle-orm';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { creditsForEvents, type SponsorCredit } from '#lib/server/sponsor/credit-service.js';
import { renderCalendar, type PosterFormat } from './calendar';
import { withPosterPage } from './browser';
import { sponsorLogos } from './sponsor-logos';

/** Who made a listing, as the poster marks it: the CMC, or a member or their group. */
export type CalendarMaker = 'cmc' | 'member';

export interface CalendarEvent {
	id: string;
	title: string;
	startsAt: Date;
	madeBy: CalendarMaker;
}

export interface MonthCalendar {
	month: string;
	events: CalendarEvent[];
	sponsors: SponsorCredit[];
}

/** `YYYY-MM` to the instants its first and next month's first day start, in club time. */
export function monthBounds(month: string): { from: Date; to: Date } {
	const [y, m] = month.split('-').map(Number);
	const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
	return {
		from: buildDateInTz(`${month}-01`, '00:00', DEFAULT_TIMEZONE),
		to: buildDateInTz(`${next}-01`, '00:00', DEFAULT_TIMEZONE)
	};
}

/**
 * A month's public listings in date order, and the sponsors their event pages
 * credit. Public means published, not a committee's, and not a meeting
 * unless a club holds it: a club's session is a meeting open to anyone
 * (decision 0061). Partner-feed imports are left out: no member made them.
 */
export async function monthCalendar(month: string): Promise<MonthCalendar> {
	const { from, to } = monthBounds(month);
	const rows = await db
		.select({
			id: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			source: eventListing.source
		})
		.from(eventListing)
		.leftJoin(group, eq(group.id, eventListing.groupId))
		.where(
			and(
				eq(eventListing.status, 'published'),
				or(ne(eventListing.kind, 'meeting'), eq(group.kind, 'club')),
				or(isNull(group.kind), ne(group.kind, 'committee')),
				gte(eventListing.startsAt, from),
				lt(eventListing.startsAt, to),
				isNull(eventListing.importSourceId)
			)
		)
		.orderBy(asc(eventListing.startsAt), asc(eventListing.title));

	const events = rows.map((r) => ({
		id: r.id,
		title: r.title,
		startsAt: r.startsAt,
		madeBy: (r.source === 'cmc' ? 'cmc' : 'member') as CalendarMaker
	}));
	const sponsors = await creditsForEvents(
		events.map((e) => e.id),
		'eventPage'
	);
	return { month, events, sponsors };
}

/** The month's poster in one format. A snapshot: nothing stores it. */
export async function renderMonthPoster(month: string, format: PosterFormat) {
	const cal = await monthCalendar(month);
	const poster = { ...cal, sponsors: await sponsorLogos(cal.sponsors) };
	return withPosterPage((page) => renderCalendar(page, poster, format));
}
