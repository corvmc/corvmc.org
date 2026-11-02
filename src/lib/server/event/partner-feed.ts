import ICAL from 'ical.js';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { buildDateTimeInTz } from '$lib/server/reservation/timezone';

/** One show as a partner's feed describes it, before it touches the database. */
export interface FeedShow {
	/** The VEVENT UID, plus `#<UTC start>` for one occurrence of a recurrence. */
	uid: string;
	title: string;
	description: string | null;
	startsAt: Date;
	endsAt: Date | null;
	location: string | null;
	url: string | null;
	cancelled: boolean;
}

/** Occurrences of one RRULE past this are dropped: a weekly event for a year is 53. */
const MAX_OCCURRENCES = 400;

function isIanaZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/**
 * A feed's wall-clock time as an instant. A `TZID` that names an IANA zone is
 * read in that zone whether or not the file defines it; one that does not
 * (a Windows name) falls back to the file's VTIMEZONE; a floating time is
 * read in `DEFAULT_TIMEZONE`, which is where every partner venue is.
 */
function toInstant(time: ICAL.Time, tzid: string | null): Date {
	if (time.zone?.tzid === 'UTC') return time.toJSDate();
	if (tzid && isIanaZone(tzid)) return buildDateTimeInTz(time, tzid);
	if (tzid && time.zone && time.zone.tzid === tzid) {
		return new Date(time.toUnixTime() * 1000);
	}
	return buildDateTimeInTz(time, DEFAULT_TIMEZONE);
}

function text(vevent: ICAL.Component, name: string): string | null {
	const value = vevent.getFirstPropertyValue(name);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * Parse an iCalendar feed into the shows that start inside `[from, until)`.
 *
 * All-day events are skipped: on a venue's calendar they are closures and
 * notices, not shows. A malformed file throws, and the caller records it.
 */
export function parseFeed(ics: string, window: { from: Date; until: Date }): FeedShow[] {
	const root = new ICAL.Component(ICAL.parse(ics));
	const shows: FeedShow[] = [];

	for (const vevent of root.getAllSubcomponents('vevent')) {
		const event = new ICAL.Event(vevent);
		if (!event.uid || !event.startDate || event.startDate.isDate) continue;
		// An override is folded into its master's expansion below.
		if (vevent.hasProperty('recurrence-id')) continue;

		const tzid = (vevent.getFirstProperty('dtstart')?.getParameter('tzid') as string) ?? null;
		const base = {
			title: event.summary?.trim() || '',
			description: text(vevent, 'description'),
			location: text(vevent, 'location'),
			url: text(vevent, 'url'),
			cancelled: text(vevent, 'status')?.toUpperCase() === 'CANCELLED'
		};
		if (!base.title) continue;

		const occurrences: { uid: string; start: ICAL.Time; end: ICAL.Time | null }[] = [];
		if (event.isRecurring()) {
			const iterator = event.iterator();
			for (let i = 0, next = iterator.next(); next && i < MAX_OCCURRENCES; i++) {
				if (toInstant(next, tzid) >= window.until) break;
				const details = event.getOccurrenceDetails(next);
				occurrences.push({
					uid: `${event.uid}#${toInstant(next, tzid).toISOString()}`,
					start: details.startDate,
					end: details.endDate
				});
				next = iterator.next();
			}
		} else {
			occurrences.push({ uid: event.uid, start: event.startDate, end: event.endDate ?? null });
		}

		for (const o of occurrences) {
			const startsAt = toInstant(o.start, tzid);
			if (startsAt < window.from || startsAt >= window.until) continue;
			const endsAt = o.end ? toInstant(o.end, tzid) : null;
			shows.push({
				...base,
				uid: o.uid,
				startsAt,
				// A zero-length or inverted end would trip `event_time_order`.
				endsAt: endsAt && endsAt > startsAt ? endsAt : null
			});
		}
	}

	return shows;
}
