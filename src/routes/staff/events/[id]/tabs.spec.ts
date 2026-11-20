import { describe, it, expect } from 'vitest';
import { eventTabHref, eventTabs, parseEventTab } from './tabs';

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
