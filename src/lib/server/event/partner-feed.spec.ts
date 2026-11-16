import { describe, it, expect } from 'vitest';
import { parseFeed } from './partner-feed';
import whiteside from './partner-feed.fixtures/whiteside.ics?raw';
import outlook from './partner-feed.fixtures/outlook.ics?raw';

const window = { from: new Date('2026-11-02T00:00:00Z'), until: new Date('2027-11-02T00:00:00Z') };
const byUid = (ics: string) => new Map(parseFeed(ics, window).map((s) => [s.uid, s]));

describe('parseFeed', () => {
	it('reads a TZID time in that zone and keeps its fields', () => {
		const show = byUid(whiteside).get('show-1@whiteside.example');
		expect(show).toEqual({
			uid: 'show-1@whiteside.example',
			title: 'Paper Wolves, Low Tide',
			description: 'Two bands.\nDoors at 7.\n\nAll ages.',
			startsAt: new Date('2026-12-06T04:00:00Z'),
			endsAt: new Date('2026-12-06T07:00:00Z'),
			location: 'The Whiteside, 361 SW Madison Ave',
			url: 'https://whiteside.example/shows/1',
			cancelled: false
		});
	});

	it('marks STATUS:CANCELLED and reads a UTC time as UTC', () => {
		const show = byUid(whiteside).get('show-2@whiteside.example');
		expect(show?.cancelled).toBe(true);
		expect(show?.startsAt).toEqual(new Date('2026-12-12T04:00:00Z'));
		expect(show?.endsAt).toBeNull();
	});

	it('skips all-day, past and untitled events', () => {
		const uids = [...byUid(whiteside).keys()];
		expect(uids).not.toContain('closed@whiteside.example');
		expect(uids).not.toContain('past@whiteside.example');
		expect(uids).not.toContain('untitled@whiteside.example');
	});

	it('expands a recurrence into one keyed show per occurrence', () => {
		const jams = parseFeed(whiteside, window).filter((s) => s.uid.startsWith('jam@'));
		expect(jams.map((s) => s.uid)).toEqual([
			'jam@whiteside.example#2026-12-04T03:00:00.000Z',
			'jam@whiteside.example#2026-12-11T03:00:00.000Z',
			'jam@whiteside.example#2026-12-18T03:00:00.000Z'
		]);
		expect(jams[0].endsAt).toEqual(new Date('2026-12-04T05:00:00Z'));
	});

	it('drops occurrences past the window', () => {
		const short = { from: window.from, until: new Date('2026-12-10T00:00:00Z') };
		const jams = parseFeed(whiteside, short).filter((s) => s.uid.startsWith('jam@'));
		expect(jams).toHaveLength(1);
	});

	it('reads a floating time in the default zone', () => {
		const show = byUid(whiteside).get('floating@whiteside.example');
		expect(show?.startsAt).toEqual(new Date('2026-12-19T05:00:00Z'));
	});

	it('falls back to the VTIMEZONE for a non-IANA TZID and drops an inverted end', () => {
		const show = byUid(outlook).get('outlook-1');
		expect(show?.startsAt).toEqual(new Date('2026-12-11T03:30:00Z'));
		expect(show?.endsAt).toBeNull();
	});

	it('throws on something that is not iCalendar', () => {
		expect(() => parseFeed('<html>Not found</html>', window)).toThrow();
	});
});
