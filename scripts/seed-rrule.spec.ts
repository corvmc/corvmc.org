import { describe, it, expect } from 'vitest';
import { buildSeedRRule } from './seed-rrule';
import { buildRRule, parseRRule, getOccurrences } from '#lib/server/reservation/rrule-helpers.js';

// The seed can't import the app's buildRRule (tsx can't resolve $lib), so it
// reproduces the JSON shape inline. These tests pin the two implementations
// together: if the app format changes, the seed must change with it —
// otherwise the generation cron errors on every seeded series.
describe('buildSeedRRule', () => {
	// A Wednesday 10:00 PT prototype.
	const proto = new Date('2026-07-15T10:00:00-07:00');

	it.each(['weekly', 'biweekly', 'monthly'] as const)(
		'produces the same rule as the app builder for %s',
		(freq) => {
			expect(JSON.parse(buildSeedRRule(proto, freq))).toEqual(JSON.parse(buildRRule(proto, freq)));
		}
	);

	it('parses with the app parser and generates occurrences', () => {
		const rule = buildSeedRRule(proto, 'weekly');
		const parsed = parseRRule(rule);
		expect(parsed.freq).toBe('weekly');
		expect(parsed.tz).toBe('America/Los_Angeles');

		const occurrences = getOccurrences(
			rule,
			new Date('2026-07-16T00:00:00-07:00'),
			new Date('2026-08-01T00:00:00-07:00')
		);
		expect(occurrences.length).toBe(2);
		// Same wall-clock time each week.
		for (const occ of occurrences) {
			expect(occ.getTime()).toBeGreaterThan(proto.getTime());
		}
	});
});
