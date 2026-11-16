import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';
import { clockEdges, addCalendarDays } from '#lib/test/clock-edges.js';
import { buildDateInTz, startOfNextDay } from '#lib/server/reservation/timezone.js';
import { rangeInstants } from '#lib/server/report/range.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';

/**
 * A "to" day ends at the next day's midnight, compared with `<` (#3061, #3067).
 * Timestamps are whole seconds, so an inclusive 23:59 or 23:59:59 bound drops
 * the rest of the minute or second. A 23:59 below is a stored deadline
 * compared against minute-resolution times, not a range bound.
 */
const allowed: { file: string; line: string; why: string }[] = [
	{ file: 'src/lib/server/reservation/series-until.ts', line: 'recurringUntil', why: 'stored' },
	{ file: 'src/lib/remote/group-events.remote.ts', line: 'recurringEndsAt', why: 'stored' },
	{ file: 'src/lib/remote/events.remote.ts', line: 'recurringEndsAt', why: 'stored' },
	{ file: 'src/lib/remote/productions.remote.ts', line: 'dueAt', why: 'stored deadline' },
	{ file: 'src/lib/remote/ballots.remote.ts', line: 'buildDateInTz(day', why: 'stored close' },
	{ file: 'src/lib/server/lock/ultraloc-client.ts', line: 'timerange', why: 'vendor daily window' }
];

const END_OF_DAY = /'23:59(?::59)?'|set(?:UTC)?Hours\(\s*23\s*,\s*59/;

const hits = sourceFiles(
	['src/lib/server/**/*.ts', 'src/lib/remote/**/*.ts', 'src/routes/**/*.ts'],
	new Set()
)
	.filter((f) => !f.endsWith('.spec.ts'))
	.flatMap((file) =>
		readFileSync(file, 'utf8')
			.split('\n')
			.filter((line) => END_OF_DAY.test(line) && !line.trim().startsWith('//'))
			.map((line) => ({ file, line: line.trim() }))
	);

const isAllowed = (h: { file: string; line: string }) =>
	allowed.some((a) => a.file === h.file && h.line.includes(a.line));

describe('end-of-day bounds', () => {
	it('builds no inclusive 23:59 bound outside the stored deadlines', () => {
		expect(hits.filter((h) => !isAllowed(h))).toEqual([]);
	});

	it('names only stored deadlines that are still there', () => {
		const stale = allowed.filter(
			(a) => !hits.some((h) => h.file === a.file && h.line.includes(a.line))
		);
		expect(stale).toEqual([]);
	});

	it.each(Object.entries(clockEdges))(
		'rangeInstants ends a "to" day at the next club midnight: %s',
		(_, edge) => {
			const { to } = rangeInstants({ to: edge.clubDate });
			const next = buildDateInTz(addCalendarDays(edge.clubDate, 1), '00:00', DEFAULT_TIMEZONE);
			const lastHalfMinute = new Date(next.getTime() - 30_000);

			expect(to).toEqual(next);
			expect(to).toEqual(startOfNextDay(edge.clubDate, DEFAULT_TIMEZONE));
			expect(lastHalfMinute < to!).toBe(true);
		}
	);
});
