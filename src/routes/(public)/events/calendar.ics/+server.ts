import type { RequestHandler } from './$types';
import { listPublicCalendarEvents } from '$lib/server/event/event-service';
import { buildIcsFeed } from '$lib/server/event/calendar-feed';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The gig guide as a subscribable calendar. A client drops any event missing
 * from a refresh, so the window reaches back a month: a show a subscriber
 * went to last week stays in their calendar instead of vanishing.
 */
export const GET: RequestHandler = async ({ url }) => {
	const now = new Date();
	const events = await listPublicCalendarEvents(
		new Date(now.getTime() - 30 * DAY_MS),
		new Date(now.getTime() + 365 * DAY_MS)
	);

	return new Response(buildIcsFeed(events, { origin: url.origin, now }), {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'inline; filename="corvmc-events.ics"',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
