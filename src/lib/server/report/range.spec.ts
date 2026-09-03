import { describe, it, expect } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { rangeCondition } from './range';
import { volunteerHourLog } from '$lib/server/db/schema/volunteer';

const dialect = new SQLiteSyncDialect();
const render = (c: SQL | undefined) => dialect.sqlToQuery(c as SQL);

/** Seconds since epoch for the bound at `index`, as the query would carry it. */
const paramAt = (c: SQL | undefined, index: number) => Number(render(c).params[index]);

describe('rangeCondition', () => {
	it('is undefined for an unbounded range, not a vacuous true', () => {
		// So a caller can spread it into `and(...)` with no special case, and so
		// an unbounded report does not carry a pointless comparison.
		expect(rangeCondition(volunteerHourLog.workedOn, {})).toBeUndefined();
	});

	it('bounds only the end that was given', () => {
		expect(
			render(rangeCondition(volunteerHourLog.workedOn, { from: '2026-07-01' })).params
		).toHaveLength(1);
		expect(
			render(rangeCondition(volunteerHourLog.workedOn, { to: '2026-07-31' })).params
		).toHaveLength(1);
		expect(
			render(rangeCondition(volunteerHourLog.workedOn, { from: '2026-07-01', to: '2026-07-31' }))
				.params
		).toHaveLength(2);
	});

	it('starts at midnight club time, not midnight UTC', () => {
		// The bug this module exists to stop reimplementing: `new Date('2026-07-01')`
		// is 00:00 UTC, which is 5pm on June 30th here — so a July report would
		// pull in the last seven hours of June.
		const at = paramAt(rangeCondition(volunteerHourLog.workedOn, { from: '2026-07-01' }), 0);

		expect(at).toBeGreaterThan(Date.parse('2026-07-01T00:00:00Z') / 1000);
		expect(new Date(at * 1000).toISOString()).toBe('2026-07-01T07:00:00.000Z');
	});

	it('includes the whole final day, not just its first instant', () => {
		// An upper bound spelled as a date reads correct and silently drops the
		// last day's work if it lands on 00:00.
		const at = paramAt(rangeCondition(volunteerHourLog.workedOn, { to: '2026-07-31' }), 0);
		const asIso = new Date(at * 1000).toISOString();

		// 23:59 club time on the 31st, which is the small hours of Aug 1 in UTC.
		expect(asIso).toBe('2026-08-01T06:59:00.000Z');
	});

	it('respects an explicit timezone over the club default', () => {
		const utc = paramAt(
			rangeCondition(volunteerHourLog.workedOn, { from: '2026-07-01' }, 'UTC'),
			0
		);
		expect(new Date(utc * 1000).toISOString()).toBe('2026-07-01T00:00:00.000Z');
	});
});
