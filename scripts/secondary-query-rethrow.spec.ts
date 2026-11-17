import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Rethrowing a failed query sends it to the panel layout's boundary, which
 * replaces the whole page. That is right only for the query the page is
 * built on. A component's query, or a page's query beside one it awaits, is
 * secondary: it shows its failure in place as an `Alert` with Retry (#3199).
 * A component that renders a page's main query is listed below.
 */
const GLOBS = ['src/routes/**/*.svelte', 'src/lib/components/**/*.svelte'];

const LOAD_BEARING = new Set([
	// The list on every paginated list page.
	'src/lib/components/ui/DataList.svelte',
	// The task table on Tasks and on a project's page.
	'src/lib/components/task/TaskCatalogue.svelte',
	// The two views of Access, each the whole tab under its stats.
	'src/routes/staff/system/access/PermissionHolders.svelte',
	'src/routes/staff/system/access/PersonAccess.svelte'
]);

const RETHROW = /\bthrow\s+\w+\.error\.e\b/;
// `const x = $derived(await query(...))` or `= await query(...)` at the top level.
const AWAITS_QUERY = /^\t(?:const|let)\s+\w+\s*=\s*(?:\$derived\()?await\s+\w+\(/m;

function rethrowsSecondary(file: string): boolean {
	const source = readFileSync(file, 'utf8');
	if (!RETHROW.test(source)) return false;
	const isRoute = /\/\+(?:page|layout)\.svelte$/.test(file);
	// A route that awaits a query is built on that one; anything it rethrows is beside it.
	return isRoute ? AWAITS_QUERY.test(source) : true;
}

describe('a failed query', () => {
	const files = sourceFiles(GLOBS, new Set());

	it('is rethrown only by the query a page is built on', () => {
		const secondary = files.filter((f) => !LOAD_BEARING.has(f) && rethrowsSecondary(f));

		expect(secondary).toEqual([]);
	});

	it('is listed as load-bearing only where it is still rethrown', () => {
		const stale = [...LOAD_BEARING].filter((f) => !files.includes(f) || !rethrowsSecondary(f));

		expect(stale).toEqual([]);
	});
});
