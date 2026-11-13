import { query } from '$app/server';
import {
	listPublicCalendarEvents,
	listPublicUpcomingEvents,
	countPublicUpcomingEvents
} from '#lib/server/event/event-service.js';
import { toCalendarEntry } from '#lib/server/event/calendar-entry.js';
import { requireUser } from '#lib/server/authorization.js';
import { currentListingViewer } from '#lib/server/event/listing-viewer.js';
import type { ListingViewer } from '#lib/server/event/visibility.js';
import { buildDateInTz, formatDateInTz } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { monthSchema, gigGuideSchema, GIG_GUIDE_PAGE_SIZE } from '#lib/types/calendar.js';

// ---------------------------------------------------------------------------
// Public calendar — unified month view across CMC and band events
// ---------------------------------------------------------------------------

/** First-of-month "YYYY-MM-DD" strings for a month and the month after it. */
function monthBounds(month: string): { start: string; end: string } {
	const [year, mo] = month.split('-').map(Number);
	const nextYear = mo === 12 ? year + 1 : year;
	const nextMo = mo === 12 ? 1 : mo + 1;
	return {
		start: `${month}-01`,
		end: `${nextYear}-${String(nextMo).padStart(2, '0')}-01`
	};
}

/**
 * Continuous upcoming list for the gig guide: events from `from` (default
 * today, venue time) forward, paged by offset.
 */
export const getPublicGigGuide = query(gigGuideSchema, (args) => gigGuide(args, null));

/** The gig guide with what a member may see too: members' and their own groups' listings. */
export const getMemberGigGuide = query(gigGuideSchema, async (args) => {
	requireUser();
	return gigGuide(args, await currentListingViewer());
});

async function gigGuide(
	{ from, offset }: { from?: string; offset: number },
	viewer: ListingViewer
) {
	const anchor = from ?? formatDateInTz(new Date(), DEFAULT_TIMEZONE);
	const windowStart = buildDateInTz(anchor, '00:00', DEFAULT_TIMEZONE);

	const [rows, total] = await Promise.all([
		listPublicUpcomingEvents(windowStart, { limit: GIG_GUIDE_PAGE_SIZE, offset }, viewer),
		countPublicUpcomingEvents(windowStart, viewer)
	]);

	const hasMore = rows.length > GIG_GUIDE_PAGE_SIZE;
	return {
		from: anchor,
		hasMore,
		/** So "Show more" can say what is left, the way the directory's does (#1059). */
		total,
		events: rows.slice(0, GIG_GUIDE_PAGE_SIZE).map(toCalendarEntry)
	};
}

export const getPublicCalendar = query(monthSchema, async ({ month }) => {
	// The window is computed in venue time so events land on the venue-local month.
	const { start, end } = monthBounds(month);
	const windowStart = buildDateInTz(start, '00:00', DEFAULT_TIMEZONE);
	const windowEnd = buildDateInTz(end, '00:00', DEFAULT_TIMEZONE);

	const rows = await listPublicCalendarEvents(windowStart, windowEnd);

	return {
		month,
		// Published only, unlike the gig list. This drives the mini-calendar's
		// per-day dots, and a dot means "something is on that night" — a
		// cancelled show advertising a day would send someone out for nothing.
		events: rows.filter((e) => e.status === 'published').map(toCalendarEntry)
	};
});
