import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sponsorPlacements } from './sponsor-placements';
import type { SeedEvent } from './types';

// Published shows after `now`, spaced by the given day gaps, so a run near a
// month end has next month's first show inside the first four.
function showsAfter(now: Date, gapDays: number[]): SeedEvent[] {
	let at = now.getTime();
	return gapDays.map((gap, i) => {
		at += gap * 86_400_000;
		return { id: `e${i}`, status: 'published', startsAt: new Date(at), endsAt: null };
	});
}

describe('the seeded sponsor placements', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it.each([
		'2026-01-31T20:00:00Z',
		'2026-01-30T20:00:00Z',
		'2026-02-28T20:00:00Z',
		'2028-02-29T20:00:00Z',
		'2026-11-26T20:00:00Z',
		'2026-12-31T20:00:00Z'
	])('place a show once per sponsorship on %s', (iso) => {
		vi.setSystemTime(new Date(iso));
		const now = new Date();
		for (const gaps of [
			[1, 2, 3, 4, 5],
			[3, 3, 3, 3, 3],
			[1, 1, 1, 1, 1],
			[10, 10, 10, 10, 10]
		]) {
			const keys = sponsorPlacements(showsAfter(now, gaps), now).map(
				(p) => `${p.sponsorshipId}/${p.eventId}`
			);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});

	it('still credits next month on the running terms', () => {
		const now = new Date('2026-01-30T20:00:00Z');
		const events = showsAfter(now, [1, 1, 1, 1, 1]);
		const ids = sponsorPlacements(events, now)
			.filter((p) => p.sponsorshipId === 'seed-sponsorship-brewery-series')
			.map((p) => p.eventId);
		expect(ids).toContain('e1');
	});
});
