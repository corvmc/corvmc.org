import { describe, it, expect } from 'vitest';
import {
	eventTabHref,
	eventTabs,
	parseEventTab,
	settleReadOnly,
	settlementHref,
	showsSettle
} from './tabs';

describe('eventTabs', () => {
	it.each([
		[{ source: 'cmc', kind: 'show' }, ['listing', 'production', 'history']],
		[{ source: 'cmc', kind: 'market' }, ['listing', 'production', 'vendors', 'history']],
		[{ source: 'band', kind: 'show' }, ['listing', 'history']],
		[{ source: 'community', kind: 'market' }, ['listing', 'vendors', 'history']]
	])('gives %o the tabs %o', (evt, tabs) => {
		expect(eventTabs(evt)).toEqual(tabs);
	});
});

describe('parseEventTab', () => {
	const show = { source: 'cmc', kind: 'show' };
	const gig = { source: 'band', kind: 'show' };

	it('opens on Listing with no tab, an unknown one, or one the event lacks', () => {
		expect(parseEventTab(null, show)).toBe('listing');
		expect(parseEventTab('overview', show)).toBe('listing');
		expect(parseEventTab('production', gig)).toBe('listing');
	});

	it('opens a tab the event has', () => {
		expect(parseEventTab('production', show)).toBe('production');
		expect(parseEventTab('history', gig)).toBe('history');
	});

	it('round-trips through the address', () => {
		for (const tab of eventTabs({ source: 'cmc', kind: 'market' })) {
			const url = new URL(`https://x${eventTabHref('e1', tab)}`);
			expect(parseEventTab(url.searchParams.get('tab'), { source: 'cmc', kind: 'market' })).toBe(
				tab
			);
		}
	});
});

describe('showsSettle', () => {
	const now = new Date('2026-12-01T20:00:00Z');
	const show = { source: 'cmc', status: 'published', startsAt: new Date('2026-12-01T19:00:00Z') };

	it("is on from a CMC show's start time", () => {
		expect(showsSettle(show, now)).toBe(true);
		expect(showsSettle({ ...show, startsAt: now }, now)).toBe(true);
	});

	it('is off before the start, for a cancelled show, and for other sources', () => {
		expect(showsSettle({ ...show, startsAt: new Date('2026-12-01T21:00:00Z') }, now)).toBe(false);
		expect(showsSettle({ ...show, status: 'cancelled' }, now)).toBe(false);
		expect(showsSettle({ ...show, source: 'band' }, now)).toBe(false);
	});

	it('links to the settlement section of the Production tab', () => {
		expect(settlementHref('e1')).toBe('/staff/events/e1?tab=production#settlement');
	});
});

describe('settleReadOnly', () => {
	it('is read-only once every act is paid, or the show is closed or cancelled', () => {
		expect(settleReadOnly({ settled: false, status: 'completed' })).toBe(false);
		expect(settleReadOnly({ settled: true, status: 'completed' })).toBe(true);
		expect(settleReadOnly({ settled: false, status: 'closed' })).toBe(true);
		expect(settleReadOnly({ settled: false, status: 'cancelled' })).toBe(true);
	});
});
