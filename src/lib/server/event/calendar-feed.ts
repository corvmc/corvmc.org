import ical, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator';
import { Feed } from 'feed';
import xss from 'xss';
import { endsForExport, UID_DOMAIN } from '$lib/utils/calendar';
import { formatDate } from '$lib/utils/format';

/** The listing fields both feeds read. `CalendarEventRow` satisfies it. */
export interface FeedEvent {
	id: string;
	title: string;
	description: string | null;
	location: string | null;
	startsAt: Date;
	endsAt: Date | null;
	status: string;
	updatedAt: Date | null;
}

interface FeedOptions {
	origin: string;
	now: Date;
}

const CALENDAR_NAME = 'Corvallis Music Collective — Gig Guide';
const CALENDAR_DESCRIPTION = 'Shows at CMC and around Corvallis, from corvmc.org/events.';

/**
 * Descriptions are rich text, and legacy rows hold HTML. A calendar client
 * shows DESCRIPTION verbatim, so tags are dropped and the few entities an
 * editor emits are decoded.
 */
function toPlainText(html: string): string {
	return xss(html.replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n'), {
		whiteList: {},
		stripIgnoreTag: true,
		stripIgnoreTagBody: ['script', 'style'],
		escapeHtml: (s) => s
	})
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const pageUrl = (origin: string, id: string) => `${origin}/events/${id}`;

/**
 * A subscribable iCalendar feed. The UID matches the per-event download's, so
 * someone who added one show by hand and then subscribed sees it once.
 */
export function buildIcsFeed(events: FeedEvent[], { origin, now }: FeedOptions): string {
	const cal = ical({
		name: CALENDAR_NAME,
		description: CALENDAR_DESCRIPTION,
		prodId: { company: 'Corvallis Music Collective', product: 'Events' },
		method: ICalCalendarMethod.PUBLISH,
		url: `${origin}/events`,
		// REFRESH-INTERVAL / X-PUBLISHED-TTL: a hint, which Google ignores.
		ttl: 60 * 60 * 6
	});

	for (const e of events) {
		cal.createEvent({
			id: `${e.id}@${UID_DOMAIN}`,
			stamp: now,
			lastModified: e.updatedAt ?? undefined,
			start: e.startsAt,
			end: endsForExport(e),
			summary: e.title,
			description: e.description ? toPlainText(e.description) : null,
			location: e.location,
			url: pageUrl(origin, e.id),
			status: e.status === 'cancelled' ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED
		});
	}
	return cal.toString();
}

/**
 * An RSS 2.0 feed of the same listings. Readers sort by `date`, so that is the
 * listing's last change, and the show's own date goes in the title.
 */
export function buildRssFeed(events: FeedEvent[], { origin, now }: FeedOptions): string {
	const feed = new Feed({
		id: `${origin}/events`,
		link: `${origin}/events`,
		title: CALENDAR_NAME,
		description: CALENDAR_DESCRIPTION,
		language: 'en',
		updated: now,
		generator: false,
		feedLinks: { rss: `${origin}/events/feed.xml` }
	});

	for (const e of events) {
		const prefix = e.status === 'cancelled' ? 'Cancelled: ' : '';
		feed.addItem({
			id: pageUrl(origin, e.id),
			link: pageUrl(origin, e.id),
			title: `${prefix}${e.title} — ${formatDate(e.startsAt)}`,
			description: [e.location, e.description ? toPlainText(e.description) : null]
				.filter(Boolean)
				.join('\n\n'),
			date: e.updatedAt ?? e.startsAt
		});
	}
	return feed.rss2();
}
