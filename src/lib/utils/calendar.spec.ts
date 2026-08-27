import { describe, it, expect } from 'vitest';
import { googleCalendarUrl, icsDataUrl } from './calendar';

const evt = {
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

describe('icsDataUrl', () => {
	it('builds a decodable VEVENT with escaped fields', () => {
		const decoded = decodeURIComponent(
			icsDataUrl(evt).replace('data:text/calendar;charset=utf-8,', '')
		);
		expect(decoded).toContain('BEGIN:VEVENT');
		expect(decoded).toContain('DTSTART:20260620T200000Z');
		expect(decoded).toContain('DTEND:20260620T230000Z');
		// comma in the title must be escaped per RFC 5545
		expect(decoded).toContain('SUMMARY:Jazz Jam\\, Vol. 2');
		expect(decoded).toContain('LOCATION:CMC Practice Space');
		expect(decoded).toContain('END:VCALENDAR');
	});
});
