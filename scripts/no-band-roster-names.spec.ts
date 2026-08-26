import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * Guards the phase-2 rename in `docs/specs/groups-spec.md`: `band_member` became
 * `group_member` and `band_slug_history` became `group_slug_history`.
 *
 * A grep gate rather than a type check, because `pnpm check` typechecks only
 * `src`, `test` and `tests` — the generated tsconfig excludes `scripts/` and
 * `e2e/` entirely. Phase 1 was bitten by exactly that: a stale schema import in
 * an e2e fixture typechecked cleanly and surfaced only when the suite ran. Hand
 * written SQL has the same blind spot at every layer; `backfill-band-owners.ts`
 * is five raw statements against the roster and nothing but this would catch it.
 *
 * The spec asks for the gate across the whole tree "because the count is what
 * keeps being wrong" — every previous attempt to enumerate the call sites by
 * hand missed some.
 */

/**
 * Word-bounded on purpose. `\bband_member\b` does not match the index and
 * constraint names — `idx_band_member_user`, `band_member_band_user_unique` —
 * which keep their old names deliberately: SQLite carries indexes through
 * `ALTER TABLE … RENAME` untouched, so renaming them would turn a free rename
 * into a table rebuild. It also does not match `band_members`, the Postgres
 * *source* table in `migrate-from-postgres.ts`.
 *
 * The symbol patterns are lowercase-initial, so they match the drizzle table
 * symbols and the relation key but not `requireBandMember`, `addBandMember`,
 * `BandMemberExistsError` or `RemoveBandMemberAction` — UI and guard names that
 * describe the band panel, which keeps its `/band/{slug}` root and is not what
 * this phase renamed.
 */
const FORBIDDEN: { pattern: RegExp; instead: string }[] = [
	{ pattern: /\bband_member\b/, instead: 'group_member' },
	{ pattern: /\bband_slug_history\b/, instead: 'group_slug_history' },
	{ pattern: /\bbandMembers?\b/, instead: 'groupMember / groupMembers' },
	{ pattern: /\bbandSlugHistory\b/, instead: 'groupSlugHistory' }
];

/**
 * `migrations/**` and `docs/**` are excluded by not being globbed: every
 * historical `migration.sql` and `snapshot.json` carries the old name forever,
 * and the spec describes the migration by name.
 */
const GLOBS = [
	'src/**/*.{ts,js,svelte}',
	'scripts/**/*.{ts,js,mjs}',
	'e2e/**/*.{ts,js}',
	'.github/**/*.yml'
];

/**
 * The schema file that *defines* the replacement, whose doc comment says what
 * the table used to be called. It is fully typechecked, so the staleness this
 * gate exists to catch cannot happen there.
 */
const ALLOWED = new Set([
	'src/lib/server/db/schema/group.ts',
	'scripts/no-band-roster-names.spec.ts'
]);

const files = GLOBS.flatMap((g) => globSync(g))
	.map((f) => f.replaceAll('\\', '/'))
	.filter((f) => !ALLOWED.has(f))
	.sort();

describe('no band roster names', () => {
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
		expect(hits, `renamed to ${instead} in groups phase 2:\n${hits.join('\n')}`).toEqual([]);
	});
});
