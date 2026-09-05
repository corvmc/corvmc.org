import { describe, it, expect } from 'vitest';
import { googleCalendarUrl, icsDataUrl } from './calendar';

const evt = {
	id: 'evt_01HZY',
	title: 'Jazz Jam, Vol. 2',
	description: 'An evening of live music',
	location: 'CMC Practice Space',
	startsAt: new Date('2026-06-20T20:00:00Z'),
	endsAt: new Date('2026-06-20T23:00:00Z')
};

describe('googleCalendarUrl', () => {
	it('encodes title, UTC dates, details and location', () => {
		const url = new URL(googleCalendarUrl(evt));
		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		expect(url.searchParams.get('text')).toBe('Jazz Jam, Vol. 2');
		expect(url.searchParams.get('dates')).toBe('20260620T200000Z/20260620T230000Z');
		expect(url.searchParams.get('details')).toBe('An evening of live music');
		expect(url.searchParams.get('location')).toBe('CMC Practice Space');
	});

	it('omits optional fields when absent', () => {
		const url = new URL(googleCalendarUrl({ ...evt, description: null, location: null }));
		expect(url.searchParams.has('details')).toBe(false);
		expect(url.searchParams.has('location')).toBe(false);
	});
});

const STAMP = new Date('2026-05-01T12:00:00Z');

/** The .ics body, decoded back out of the data URL. */
function ics(e: Parameters<typeof icsDataUrl>[0] = evt): string {
	return decodeURIComponent(icsDataUrl(e, STAMP).replace('data:text/calendar;charset=utf-8,', ''));
}

describe('icsDataUrl', () => {
	it('builds a decodable VEVENT with escaped fields', () => {
		const decoded = ics();
		expect(decoded).toContain('BEGIN:VEVENT');
		expect(decoded).toContain('DTSTART:20260620T200000Z');
		expect(decoded).toContain('DTEND:20260620T230000Z');
		// comma in the title must be escaped per RFC 5545
		expect(decoded).toContain('SUMMARY:Jazz Jam\\, Vol. 2');
		expect(decoded).toContain('LOCATION:CMC Practice Space');
		expect(decoded).toContain('END:VCALENDAR');
	});

	// Both are REQUIRED by RFC 5545 and both were missing. Without a UID a
	// client cannot tell a re-import from a second event, so an attendee whose
	// show moved ends up holding two.
	it('emits the required UID and DTSTAMP', () => {
		const decoded = ics();
		expect(decoded).toContain('UID:evt_01HZY@corvmc.org');
		expect(decoded).toContain('DTSTAMP:20260501T120000Z');
	});

	it('keeps the UID stable when the event details change', () => {
		expect(ics({ ...evt, title: 'Renamed', startsAt: new Date('2026-07-01T01:00:00Z') })).toContain(
			'UID:evt_01HZY@corvmc.org'
		);
	});

	// RFC 5545 caps a content line at 75 OCTETS. A long description used to be
	// emitted as one line, which a strict parser is entitled to reject.
	it('folds every content line to 75 octets or fewer', () => {
		const decoded = ics({ ...evt, description: 'An evening of live music. '.repeat(20) });
		const encoder = new TextEncoder();
		for (const line of decoded.split('\r\n')) {
			expect(encoder.encode(line).length, line).toBeLessThanOrEqual(75);
		}
	});

	it('continues a folded line with a single space', () => {
		const decoded = ics({ ...evt, description: 'x'.repeat(200) });
		const continued = decoded.split('\r\n').filter((l) => l.startsWith(' '));
		expect(continued.length).toBeGreaterThan(0);
		// Unfolding — drop the CRLF and the one space — restores the original run.
		expect(decoded.replace(/\r\n /g, '')).toContain(`DESCRIPTION:${'x'.repeat(200)}`);
	});

	// Folding counts octets, so a naive character split lands mid-codepoint and
	// produces a file that will not parse at all.
	it('never splits a multi-byte character', () => {
		const decoded = ics({ ...evt, description: '🎸'.repeat(60) });
		expect(decoded).not.toContain('\uFFFD');
		expect(decoded.replace(/\r\n /g, '')).toContain(`DESCRIPTION:${'🎸'.repeat(60)}`);
	});
});
