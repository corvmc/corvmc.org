/**
 * The seed's randomness is seeded, and these tests are what keep it that way.
 *
 * Row counts used to swing 10–50% between two runs of `pnpm db:reset`, which
 * made the summary block impossible to diff: you could not tell a change you
 * made from noise. `util.ts` now draws from `zod4-mock`'s SFC32 generator with a
 * fixed seed.
 *
 * The sequences below are pinned rather than merely checked for repeatability,
 * because a *repeatable* generator that quietly changed algorithm would still
 * invalidate every count anybody had written down. Swapping the PRNG is allowed
 * — silently swapping it is not, and this is the file that says so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SEED, pick, pickN, random, randomInt } from './util';

describe('seed randomness', () => {
	it('runs on a fixed seed', () => {
		expect(SEED).toBe(42);
	});

	// One module-level generator feeds all four helpers, so these run in order
	// and each one consumes from where the last left off. Split them into
	// separate `it`s and the expectations below stop being true.
	it('draws the same sequence on every run', () => {
		expect(Array.from({ length: 6 }, () => Number(random().toFixed(10)))).toEqual([
			0.9141136743, 0.5449087752, 0.7925117072, 0.2325277298, 0.8740452554, 0.1423605136
		]);

		expect(Array.from({ length: 8 }, () => randomInt(1, 100))).toEqual([
			11, 41, 84, 80, 61, 79, 16, 39
		]);

		const POOL = ['a', 'b', 'c', 'd', 'e'] as const;
		expect(Array.from({ length: 8 }, () => pick(POOL))).toEqual([
			'e',
			'c',
			'd',
			'c',
			'b',
			'd',
			'd',
			'b'
		]);
		expect(pickN(POOL, 3)).toEqual(['c', 'd', 'b']);
	});

	it('keeps `randomInt` inside its bounds, endpoints included', () => {
		const seen = new Set(Array.from({ length: 500 }, () => randomInt(3, 7)));
		expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
	});

	it('never reaches for the global generator', () => {
		// `pick`/`pickN`/`randomInt` are seeded, but a seeder that calls
		// `Math.random()` directly is not — and 46 of them used to. `random()` from
		// this module is the replacement.
		const offenders = readdirSync(new URL('.', import.meta.url))
			.filter((name) => name.endsWith('.ts') && name !== 'util.ts' && !name.endsWith('.spec.ts'))
			.filter((name) => {
				const source = readFileSync(new URL(name, import.meta.url), 'utf8');
				// Comment lines are prose about the rule, not a breach of it.
				return source.split('\n').some((line) => {
					const trimmed = line.trim();
					if (trimmed.startsWith('*') || trimmed.startsWith('//')) return false;
					return trimmed.includes('Math.random(');
				});
			});

		expect(offenders, 'use `random()` from ./util instead').toEqual([]);
	});
});
