import { globSync, statSync } from 'node:fs';

/**
 * The file list behind the tree-wide grep gates in `scripts/`, extracted from
 * `no-band-roster-names.spec.ts` and `no-directory-tag-tables.spec.ts`, which
 * built it inline and identically.
 *
 * The `isFile` filter is the part that is not obvious. `globSync` returns
 * directories as readily as files, and a directory named like a source file is
 * not hypothetical here: vitest's browser mode used to write failure screenshots
 * to `<test dir>/__screenshots__/<file>.svelte.spec.ts/`, whose middle segment
 * matches `src/**\/*.{ts,js,svelte}`. Both gates then `readFileSync` every hit,
 * so a single flaky browser test surfaced as ten `EISDIR` failures in two
 * unrelated schema gates and cost a merge-queue slot. Screenshots now land in
 * `test-results/`, and this filter means the next path shaped like that one is
 * simply not a source file rather than an error with nobody's name on it.
 */
export function sourceFiles(globs: string[], allowed: ReadonlySet<string>): string[] {
	return globs
		.flatMap((g) => globSync(g))
		.map((f) => f.replaceAll('\\', '/'))
		.filter((f) => !allowed.has(f))
		.filter((f) => statSync(f).isFile())
		.sort();
}
