import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every table named inside a hand-written `sql` fragment still exists.
 *
 * Drizzle checks nothing about a raw template: `sql\`... FROM some_table\`` is
 * just text until SQLite refuses it at runtime. So a migration that drops or
 * renames a table silently leaves any hand-written reference to it behind, and
 * the query fails only when someone loads the page.
 *
 * That is not hypothetical. `messaging_standing` was consolidated into
 * `member_standing` and dropped; four fragments in `direct-service.ts` kept
 * naming it, and two of them backed `/member/messages`, so the page 500'd for
 * every member. Nothing caught it — the service specs mock `db` wholesale and
 * never see the SQL, which is exactly the blind spot this test covers.
 *
 * Deliberately a text scan rather than a rendered query: it reaches every
 * fragment in the tree, including ones behind a branch no test happens to take.
 */

const SERVER_DIR = join(process.cwd(), 'src/lib/server');
const SCHEMA_DIR = join(SERVER_DIR, 'db/schema');

function tsFilesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return tsFilesUnder(full);
		if (!entry.name.endsWith('.ts')) return [];
		if (/\.(spec|test)\.ts$/.test(entry.name)) return [];
		return [full];
	});
}

/** Table names as drizzle declares them. */
function declaredTables(): Set<string> {
	const names = new Set<string>();
	for (const file of tsFilesUnder(SCHEMA_DIR)) {
		const text = readFileSync(file, 'utf8');
		for (const m of text.matchAll(/sqliteTable\(\s*['"]([a-z0-9_]+)['"]/gi)) {
			names.add(m[1]);
		}
	}
	return names;
}

/**
 * Strip comments before scanning.
 *
 * Prose mentioning ``raw `sql` `` opens a phantom template that swallows the
 * rest of the comment, and any "JOIN" in that English then reads as a table
 * name. Block comments are stripped whole; line comments only when they start
 * the line, so a `https://` inside a string is left alone.
 */
function withoutComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Tables named after FROM or JOIN inside a `sql` template literal. */
function rawSqlTableRefs(): { table: string; file: string }[] {
	const refs: { table: string; file: string }[] = [];
	for (const file of tsFilesUnder(SERVER_DIR)) {
		const text = withoutComments(readFileSync(file, 'utf8'));
		for (const template of text.matchAll(/sql`([^`]*)`/gs)) {
			// Both quoting styles: drizzle emits `"user"`, and hand-written fragments
			// use bare names or backticks. A regex that missed one would give a
			// false pass on exactly the kind of literal this exists to catch.
			for (const ref of template[1].matchAll(/\b(?:FROM|JOIN)\s+["`]?([a-z_][a-z0-9_]*)["`]?/gi)) {
				refs.push({ table: ref[1].toLowerCase(), file: file.slice(process.cwd().length + 1) });
			}
		}
	}
	return refs;
}

describe('hand-written SQL', () => {
	it('names only tables the schema declares', () => {
		const tables = declaredTables();
		// A guard on the guard: if the schema scan ever stops matching, every
		// reference below would "pass" by comparing against an empty set.
		expect(tables.size).toBeGreaterThan(20);

		const unknown = rawSqlTableRefs().filter((ref) => !tables.has(ref.table));

		expect(unknown).toEqual([]);
	});
});
