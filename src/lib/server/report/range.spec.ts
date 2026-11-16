import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { rangeCondition } from './range';
import { volunteerHourLog } from '#lib/server/db/schema/volunteer.js';

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

	// #3061: timestamps are whole seconds, so `<= 23:59` dropped 23:59:01–23:59:59.
	it('includes the whole final day, up to the next midnight and not including it', () => {
		const c = rangeCondition(volunteerHourLog.workedOn, { to: '2026-07-31' });
		const at = paramAt(c, 0);

		// Midnight club time on Aug 1, which is 07:00 UTC.
		expect(new Date(at * 1000).toISOString()).toBe('2026-08-01T07:00:00.000Z');
		expect(render(c).sql).toMatch(/ < \?$/);
	});

	it('respects an explicit timezone over the club default', () => {
		const utc = paramAt(
			rangeCondition(volunteerHourLog.workedOn, { from: '2026-07-01' }, 'UTC'),
			0
		);
		expect(new Date(utc * 1000).toISOString()).toBe('2026-07-01T00:00:00.000Z');
	});
});

/**
 * The class behind #3061: an inclusive "to" day bounded with `lte(…, 23:59)`.
 * Every such filter goes through `rangeCondition`, so no server module spells
 * the bound itself.
 */
describe('end-of-day bounds', () => {
	const src = join(import.meta.dirname, '../..');
	const files = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? files(join(dir, e.name))
				: e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')
					? [join(dir, e.name)]
					: []
		);

	it("bounds no column with lte at 23:59; rangeCondition's next-midnight bound covers the day", () => {
		const scanned = [...files(join(src, 'server')), ...files(join(src, 'remote'))];
		const found = scanned.filter((f) =>
			/\blte\([^;]*?buildDateInTz\([^)]*'23:59'/s.test(readFileSync(f, 'utf8'))
		);
		expect(scanned.length).toBeGreaterThan(100);
		expect(found.map((f) => relative(src, f))).toEqual([]);
	});
});
