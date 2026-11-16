import { describe, it, expect } from 'vitest';
import { groupGigs } from './gig-groups';
import type { CalendarEntry } from '#lib/types/calendar.js';

/** Minimal entry starting at local noon on the given day. */
function entry(id: string, day: string): CalendarEntry {
	const [y, m, d] = day.split('-').map(Number);
	return {
		id,
		title: id,
		startsAt: new Date(y, m - 1, d, 12, 0),
		endsAt: new Date(y, m - 1, d, 14, 0),
		source: 'cmc',
		status: 'published',
		location: null,
		bandName: null,
		bandSlug: null,
		posterUrl: null,
		ticketingEnabled: false,
		ticketPrice: null,
		externalTicketUrl: null
	};
}

const labels = (groups: [string, CalendarEntry[]][]) => groups.map(([label]) => label);

describe('groupGigs', () => {
	const today = '2026-08-12'; // a Wednesday mid-month

	it('buckets into This Week, This Month, Looking Ahead', () => {
		const groups = groupGigs(
			[
				entry('today', '2026-08-12'),
				entry('week-edge', '2026-08-18'), // today + 6
				entry('month', '2026-08-19'), // today + 7, same month
				entry('month-end', '2026-08-31'),
				entry('next-month', '2026-09-02')
			],
			today
		);

		expect(labels(groups)).toEqual(['This Week', 'This Month', 'Looking Ahead']);
		expect(groups[0][1].map((e) => e.id)).toEqual(['today', 'week-edge']);
		expect(groups[1][1].map((e) => e.id)).toEqual(['month', 'month-end']);
		expect(groups[2][1].map((e) => e.id)).toEqual(['next-month']);
	});

	it('puts a next-month event within 6 days into This Week', () => {
		const groups = groupGigs([entry('soon', '2026-09-02')], '2026-08-30');
		expect(labels(groups)).toEqual(['This Week']);
	});

	it('groups past entries under their month name', () => {
		const groups = groupGigs(
			[entry('past-july', '2026-07-05'), entry('past-aug', '2026-08-01'), entry('now', today)],
			today
		);
		expect(labels(groups)).toEqual(['July 2026', 'August 2026', 'This Week']);
	});

	it('returns no groups for no entries', () => {
		expect(groupGigs([], today)).toEqual([]);
	});
});
