import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A booker never waits behind themselves (#3031). Every call that can write a
 * waitlisted reservation row asks `heldBySameBooker()` earlier in the same
 * function, so a slot the booker already holds is refused or skipped rather
 * than queued as a duplicate. `createWaitlisted()` asks for all its callers.
 */
const EXEMPT: Record<string, string> = {
	// The hold's booker is the listing `copyListing()` created a line earlier.
	'src/lib/server/reservation/event-series-reschedule.ts': 'fresh listing booker'
};

const files = sourceFiles(['src/**/*.ts'], new Set(Object.keys(EXEMPT))).filter(
	(f) => !f.endsWith('.spec.ts')
);

/** The argument text of each `insertReservation(` / `staffCreate(` call. */
function writes(source: string): { at: number; args: string }[] {
	const out: { at: number; args: string }[] = [];
	for (const match of source.matchAll(/\b(?:insertReservation|staffCreate)\(/g)) {
		const start = match.index + match[0].length;
		let depth = 1;
		let i = start;
		while (i < source.length && depth > 0) {
			if (source[i] === '(') depth++;
			else if (source[i] === ')') depth--;
			i++;
		}
		out.push({ at: match.index, args: source.slice(start, i - 1) });
	}
	return out;
}

/** Source from the nearest preceding function declaration up to `at`. */
function enclosing(source: string, at: number): string {
	const before = source.slice(0, at);
	const starts = [...before.matchAll(/\bfunction\s+\w+\s*[(<]/g)];
	return before.slice(starts.at(-1)?.index ?? 0);
}

describe('waitlisted reservation writes', () => {
	it('finds the known waitlist writers', () => {
		const writers = files.filter((f) =>
			writes(readFileSync(f, 'utf8')).some((w) => w.args.includes("'waitlisted'"))
		);
		expect(writers).toEqual(
			expect.arrayContaining([
				'src/lib/server/reservation/generation-job.ts',
				'src/lib/server/reservation/reservation-service.ts'
			])
		);
	});

	it('check the same booker first', () => {
		const misses: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const w of writes(source)) {
				if (!w.args.includes("'waitlisted'")) continue;
				if (/\bheldBySameBooker\(/.test(enclosing(source, w.at))) continue;
				const line = source.slice(0, w.at).split('\n').length;
				misses.push(`${file}:${line}`);
			}
		}
		expect(misses, misses.join('\n')).toEqual([]);
	});
});
