import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A top-level `const x = await someQuery()` in a component script runs once.
 * Kit refreshes the query after a form succeeds, but `x` keeps the first
 * value, so whatever the page renders from it goes stale until a reload: the
 * teaching card kept showing a withdrawn application (#2846). Read the query's
 * `.current` where it renders, or list the file below as holding nothing a
 * form on its page changes.
 */
const GLOBS = ['src/routes/**/*.svelte', 'src/lib/components/**/*.svelte'];

/**
 * A list rather than a count, so two PRs editing it conflict in git instead of
 * silently disagreeing.
 */
const READ_ONCE = new Set([
	// Totals strips with no form on their pages.
	'src/routes/staff/groups/ClubTotals.svelte',
	'src/routes/staff/groups/BandTotals.svelte',
	'src/routes/staff/members/UserTotals.svelte',
	'src/routes/staff/events/CalendarTotals.svelte'
]);

/** Names imported from a `*.remote` module. */
function remoteImports(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*\.remote(?:\.js)?'/g)) {
		for (const part of m[1].split(',')) {
			const name = part
				.split(/\s+as\s+/)
				.pop()
				?.trim();
			if (name) names.add(name);
		}
	}
	return names;
}

/** Whether the instance script awaits a remote query into a declaration at its top level. */
function awaitsQueryAtTop(file: string): boolean {
	const source = readFileSync(file, 'utf8');
	const remote = remoteImports(source);
	// One tab of indent is the script's top level; deeper ones sit inside functions.
	const declarations = source.matchAll(
		/^\t(?:const|let)\s+(?:\{[^}]*\}|\w+)\s*=\s*await\s+(\w+)\(/gm
	);
	return [...declarations].some((m) => remote.has(m[1]));
}

describe('component scripts', () => {
	const files = sourceFiles(GLOBS, new Set());

	it('do not await a remote query into a constant, or are listed as read-once', () => {
		const stale = files.filter((f) => !READ_ONCE.has(f) && awaitsQueryAtTop(f));

		expect(stale).toEqual([]);
	});

	it('list only files that still exist and still await at the top', () => {
		const listed = [...READ_ONCE].filter((f) => !files.includes(f) || !awaitsQueryAtTop(f));

		expect(listed).toEqual([]);
	});
});
