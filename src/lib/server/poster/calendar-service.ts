import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { groupMember } from '#lib/server/db/schema/group.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE, type EventSource } from '#lib/config.js';
import { creditsForEvents, type SponsorCredit } from '#lib/server/sponsor/credit-service.js';
import { renderCalendar } from './calendar';
import { sponsorLogos } from './sponsor-logos';

/** The poster's three blocks, in the order they print. */
export const calendarBlocks = ['cmc', 'sustaining', 'member'] as const;
export type CalendarBlock = (typeof calendarBlocks)[number];

export interface CalendarFacts {
	source: EventSource;
	/** An active member of the owning group has a subscription. */
	groupHasSustaining: boolean;
	/** The member who submitted the listing has a subscription. */
	creatorIsSustaining: boolean;
}

/**
 * Which block a listing prints in. A band or group listing is a sustaining
 * member's when any active member of the owning group subscribes; a community
 * listing when its submitter does (#2597).
 */
export function calendarBlock(e: CalendarFacts): CalendarBlock {
	if (e.source === 'cmc') return 'cmc';
	const sustaining = e.source === 'community' ? e.creatorIsSustaining : e.groupHasSustaining;
	return sustaining ? 'sustaining' : 'member';
}

export interface CalendarEvent {
	id: string;
	title: string;
	startsAt: Date;
}

export interface MonthCalendar {
	month: string;
	blocks: { block: CalendarBlock; events: CalendarEvent[] }[];
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

// Drizzle prints an interpolated column unqualified in a one-table select, and
// inside these subqueries a bare `group_id` would bind to `gm`, not the listing.
const outer = (column: string) => sql.raw(`"event_listing"."${column}"`);

/**
 * A month's published listings, grouped into the poster's blocks, and the
 * sponsors their event pages credit. Partner-feed imports are left out: no
 * member made them.
 */
export async function monthCalendar(month: string): Promise<MonthCalendar> {
	const { from, to } = monthBounds(month);
	const rows = await db
		.select({
			id: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			source: eventListing.source,
			groupHasSustaining: sql<boolean>`exists (
				select 1 from ${groupMember} gm join ${user} u on u.id = gm.user_id
				where gm.group_id = ${outer('group_id')} and gm.status = 'active'
					and u.subscription is not null
			)`.mapWith(Boolean),
			creatorIsSustaining: sql<boolean>`exists (
				select 1 from ${user} u
				where u.id = ${outer('created_by_user_id')} and u.subscription is not null
			)`.mapWith(Boolean)
		})
		.from(eventListing)
		.where(
			and(
				eq(eventListing.status, 'published'),
				gte(eventListing.startsAt, from),
				lt(eventListing.startsAt, to),
				isNull(eventListing.importSourceId)
			)
		)
		.orderBy(asc(eventListing.startsAt), asc(eventListing.title));

	const blocks = calendarBlocks.map((block) => ({ block, events: [] as CalendarEvent[] }));
	for (const r of rows) {
		blocks
			.find((b) => b.block === calendarBlock(r))!
			.events.push({ id: r.id, title: r.title, startsAt: r.startsAt });
	}
	const sponsors = await creditsForEvents(
		rows.map((r) => r.id),
		'eventPage'
	);
	return { month, blocks, sponsors };
}

/** The month's calendar poster as a PNG. A snapshot: nothing stores it. */
export async function renderMonthPoster(month: string): Promise<Uint8Array> {
	const cal = await monthCalendar(month);
	return renderCalendar({ ...cal, sponsors: await sponsorLogos(cal.sponsors) });
}
