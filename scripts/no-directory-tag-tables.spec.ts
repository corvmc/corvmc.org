import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
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
 * Both halves are armed as of phase 3c. The raw table names could not arm
 * earlier: the tables still physically existed, so `scripts/d1-table-order.mjs`
 * and `deleteAll()` in `scripts/seed-dev.ts` had to keep naming them for the e2e
 * reset and the local seed to clear them. The DROP TABLE migration removed that
 * constraint along with the tables.
 */
const FORBIDDEN: { pattern: RegExp; instead: string }[] = [
	{ pattern: /\bbandGenre\b/, instead: "directoryTag with kind: 'genre'" },
	{ pattern: /\buserGenre\b/, instead: "directoryTag with kind: 'genre'" },
	{ pattern: /\buserInstrument\b/, instead: "directoryTag with kind: 'instrument'" },
	{ pattern: /\bband_genre\b/, instead: "directory_tag with kind = 'genre'" },
	{ pattern: /\buser_genre\b/, instead: "directory_tag with kind = 'genre'" },
	{ pattern: /\buser_instrument\b/, instead: "directory_tag with kind = 'instrument'" }
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
 * The backfill that drained the three tables, and its spec, which has to create
 * them as fixtures to test it. Both are a record of a migration that has already
 * run; the SQL is unrunnable now that the tables are gone, and that is fine —
 * `migrations/` keeps its history the same way.
 */
const ALLOWED = new Set([
	'scripts/db/backfill/directory-entry.spec.ts',
	'scripts/no-directory-tag-tables.spec.ts'
]);

/**
 * Comments are not references. The point of this gate is that no code reads the
 * folded tables; several files legitimately *name* them while explaining what
 * replaced them, and an exemption for each would hollow the gate out — the
 * schema file that defines `directory_tag` is exactly the file it most needs to
 * cover. Stripping line comments first is what lets the ALLOWED list stay two
 * entries instead of six.
 */
function isComment(line: string): boolean {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--');
}

/**
 * `isFile` is not paranoia: a failing browser test writes its screenshot to a
 * *directory* named after the spec — `__screenshots__/Foo.svelte.spec.ts/` —
 * which `src/**` matches and `readFileSync` answers with EISDIR. That turned
 * one red client test into ten red gate failures naming tables nobody had
 * touched, which is the opposite of what a gate is for.
 */
const files = GLOBS.flatMap((g) => globSync(g))
	.map((f) => f.replaceAll('\\', '/'))
	.filter((f) => !ALLOWED.has(f) && statSync(f).isFile())
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
				if (!isComment(line) && pattern.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
			});
		}
		expect(
			hits,
			`folded into directory_tag in groups phase 3a — use ${instead}:\n${hits.join('\n')}`
		).toEqual([]);
	});
});
