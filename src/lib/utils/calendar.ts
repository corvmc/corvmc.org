// Add-to-calendar helpers — dependency-free. Build a Google Calendar "template" link and
// an inline .ics data URL from an event. Both emit UTC timestamps (YYYYMMDDTHHMMSSZ), the
// format Google and the iCalendar spec expect.

export interface CalendarEvent {
	/**
	 * The event's own id. Becomes the VEVENT's `UID`, which is how a calendar
	 * tells "the same event again" from "a second event": re-importing after a
	 * time change updates the entry in place instead of leaving the attendee
	 * with two. It must therefore stay stable for the life of the event — do not
	 * derive it from any field a staffer can edit.
	 */
	id: string;
	title: string;
	description?: string | null;
	location?: string | null;
	startsAt: Date;
	/** Null when unknown — see `endsForExport`. */
	endsAt: Date | null;
}

/**
 * ICS and Google Calendar both require an end, but `event.endsAt` is nullable
 * because a band backfilling old gigs often doesn't know one. Rather than
 * refuse to export, assume a two-hour set — a convention of the exported file,
 * never written back to the database.
 */
const ASSUMED_DURATION_MS = 2 * 60 * 60 * 1000;

function endsForExport(evt: CalendarEvent): Date {
	return evt.endsAt ?? new Date(evt.startsAt.getTime() + ASSUMED_DURATION_MS);
}

/** Format a Date as a UTC iCalendar timestamp, e.g. 20260620T200000Z. */
function toICSDate(d: Date): string {
	return d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

/** Escape a value for inclusion in an ICS text field (RFC 5545). */
function escapeICS(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n');
}

/** Google Calendar "add event" URL with the event prefilled. */
export function googleCalendarUrl(evt: CalendarEvent): string {
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: evt.title,
		dates: `${toICSDate(evt.startsAt)}/${toICSDate(endsForExport(evt))}`
	});
	if (evt.description) params.set('details', evt.description);
	if (evt.location) params.set('location', evt.location);
	return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * The domain half of the `UID`. RFC 5545 wants a globally unique value, and the
 * convention is `<local part>@<domain>`. Hard-coded rather than read from
 * `PUBLIC_SITE_URL` for the same reason the id itself is stable: a UID that
 * changes when a config value changes silently duplicates every event already
 * in an attendee's calendar.
 */
const UID_DOMAIN = 'corvmc.org';

/**
 * Fold a content line to RFC 5545's 75-**octet** limit.
 *
 * Counted in octets, not characters: a line of accented text or emoji hits the
 * limit sooner than its length suggests, and splitting mid-codepoint produces a
 * file that will not parse. Continuation lines begin with a single space, which
 * the reader strips.
 */
function foldICSLine(line: string): string {
	const bytes = new TextEncoder().encode(line);
	if (bytes.length <= 75) return line;

	const decoder = new TextDecoder();
	const out: string[] = [];
	let start = 0;
	// The first line gets 75 octets; every continuation spends one on its
	// leading space, so it carries 74.
	let budget = 75;
	while (start < bytes.length) {
		let end = Math.min(start + budget, bytes.length);
		// Back off the split point until it is a codepoint boundary — a UTF-8
		// continuation byte is 0b10xxxxxx.
		while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--;
		out.push(decoder.decode(bytes.subarray(start, end)));
		start = end;
		budget = 74;
	}
	return out.join('\r\n ');
}

/**
 * A `data:text/calendar` URL holding a single-event .ics file, for download.
 *
 * `now` is the `DTSTAMP` — when this calendar object was built, which is what
 * the spec asks for and what lets a client order two versions of the same UID.
 * Injectable only so the tests have something to assert.
 */
export function icsDataUrl(evt: CalendarEvent, now: Date = new Date()): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Corvallis Music Collective//Events//EN',
		'BEGIN:VEVENT',
		// UID and DTSTAMP are both REQUIRED by RFC 5545. Google tolerated their
		// absence; Apple Calendar and Outlook are entitled not to, and without a
		// UID neither can tell a re-import from a duplicate.
		`UID:${evt.id}@${UID_DOMAIN}`,
		`DTSTAMP:${toICSDate(now)}`,
		`DTSTART:${toICSDate(evt.startsAt)}`,
		`DTEND:${toICSDate(endsForExport(evt))}`,
		`SUMMARY:${escapeICS(evt.title)}`
	];
	if (evt.description) lines.push(`DESCRIPTION:${escapeICS(evt.description)}`);
	if (evt.location) lines.push(`LOCATION:${escapeICS(evt.location)}`);
	lines.push('END:VEVENT', 'END:VCALENDAR');

	const body = lines.map(foldICSLine).join('\r\n');
	return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}
