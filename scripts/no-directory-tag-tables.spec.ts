import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * Guards the phase-3a fold in `docs/specs/groups-spec.md`: `band_genre`,
 * `user_genre` and `user_instrument` became one `directory_tag` table
 * discriminated by `kind`.
 *
 * Modelled on `scripts/no-band-roster-names.spec.ts`, and for the same reason:
 * `pnpm check` typechecks only `src`, `test` and `tests`, so a stale reference
 * in `scripts/` or `e2e/` compiles fine and fails at runtime. That is not
 * hypothetical here — the seed and the e2e fixtures were the last two things
 * still writing the old tables, and an e2e fixture that quietly kept doing so
 * would leave those rows invisible to a directory that no longer reads them.
 *
 * This gate is armed in two stages, because the two hazards stop being possible
 * at different times.
 */

/**
 * Armed now: the drizzle symbols. Nothing imports them any more — the
 * declarations survive only so `pnpm db:generate` does not emit `DROP TABLE`
 * before phase 3c, which is why the two schema files are in ALLOWED below.
 *
 * Lowercase-initial and word-bounded, matching the sibling gate's reasoning:
 * these match the table symbols, not a `BandGenre` type or a `UserGenreList`
 * component that might legitimately exist later.
 *
 * **Deferred to phase 3c: the raw table names** — `/\bband_genre\b/`,
 * `/\buser_genre\b/`, `/\buser_instrument\b/`. They cannot arm yet, because the
 * tables still physically exist in D1 and so must stay listed in
 * `scripts/d1-table-order.mjs` and in `deleteAll()` in `scripts/seed-dev.ts` for
 * the e2e reset and the local seed to keep clearing them. Arming them now would
 * force an ALLOWED entry for the two files this gate most needs to cover.
 * Uncomment them in 3c, once the DROP TABLE migration lands.
 */
const FORBIDDEN: { pattern: RegExp; instead: string }[] = [
	{ pattern: /\bbandGenre\b/, instead: "directoryTag with kind: 'genre'" },
	{ pattern: /\buserGenre\b/, instead: "directoryTag with kind: 'genre'" },
	{ pattern: /\buserInstrument\b/, instead: "directoryTag with kind: 'instrument'" }
];

/**
 * `migrations/**` and `docs/**` are excluded by not being globbed: every
 * historical `migration.sql` and `snapshot.json` carries the old tables forever,
 * and the spec describes the fold by name.
 */
const GLOBS = [
	'src/**/*.{ts,js,svelte}',
	'scripts/**/*.{ts,js,mjs}',
	'e2e/**/*.{ts,js}',
	'.github/**/*.yml'
];

/**
 * The two schema files that still *declare* the folded tables, and the file
 * defining what replaced them. The declarations are dead weight kept only to
 * hold `pnpm db:generate` off until 3c; both carry a comment saying so, and both
 * are fully typechecked, so the staleness this gate exists to catch cannot
 * happen there.
 */
const ALLOWED = new Set([
	'src/lib/server/db/schema/band.ts',
	'src/lib/server/db/schema/authentication.ts',
	'src/lib/server/db/schema/directory.ts',
	'scripts/no-directory-tag-tables.spec.ts'
]);

const files = GLOBS.flatMap((g) => globSync(g))
	.map((f) => f.replaceAll('\\', '/'))
	.filter((f) => !ALLOWED.has(f))
	.sort();

describe('no folded tag tables', () => {
	it('finds source files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it.each(FORBIDDEN)('nothing references $pattern', ({ pattern, instead }) => {
		const hits: string[] = [];
		for (const file of files) {
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				if (pattern.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
			});
		}
		expect(
			hits,
			`folded into directory_tag in groups phase 3a — use ${instead}:\n${hits.join('\n')}`
		).toEqual([]);
	});
});
