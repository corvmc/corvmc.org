import type { RequestHandler } from './$types';
import { listPublicUpcomingEvents } from '$lib/server/event/event-service';
import { buildRssFeed } from '$lib/server/event/calendar-feed';

const FEED_SIZE = 100;

/** Upcoming public listings as RSS 2.0, soonest first. */
export const GET: RequestHandler = async ({ url }) => {
	const now = new Date();
	// Fetches limit+1 so the guide can page; the feed has no pager.
	const events = (await listPublicUpcomingEvents(now, { limit: FEED_SIZE, offset: 0 })).slice(
		0,
		FEED_SIZE
	);

	return new Response(buildRssFeed(events, { origin: url.origin, now }), {
		headers: {
			'Content-Type': 'application/rss+xml; charset=utf-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
