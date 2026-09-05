import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every table named inside a raw `sql` template has to exist.
 *
 * Drizzle checks the tables you reference through the schema objects; it cannot
 * check the ones you spell out as text. Most of the time that is fine, because
 * the query either works or does not the first time anyone runs it. It stops
 * being fine when a table is **renamed**: `pnpm check` reports zero errors, every
 * unit test passes, and the failure surfaces only when a real request hits the
 * statement and D1 answers `no such table`.
 *
 * That is not hypothetical. The `event` → `event_listing` rename (#527) left one
 * such string behind in `volunteer-signup-service.ts` and took out every
 * /staff/volunteer page; nothing but the E2E suite noticed, twenty minutes in.
 *
 * The table list comes from drizzle's own snapshot — the same source of truth
 * `d1-table-order.spec.ts` and `d1-ddl.mjs` read — so this test moves with the
 * schema instead of being a second list to maintain.
 */

/** Newest `migrations/<timestamp>_<name>/snapshot.json` — dir names sort chronologically. */
function latestSnapshot() {
	const dir = new URL('../../migrations/', import.meta.url);
	const names = readdirSync(dir)
		.filter((n) => /^\d{14}_/.test(n))
		.sort();
	const latest = names[names.length - 1];
	return JSON.parse(readFileSync(new URL(`${latest}/snapshot.json`, dir), 'utf8'));
}

const schemaTables = new Set<string>(
	latestSnapshot()
		.ddl.filter((e: { entityType: string }) => e.entityType === 'tables')
		.map((e: { name: string }) => e.name)
);

/**
 * Tables SQLite provides that no snapshot will ever list. `pragma_*` functions are
 * not here because they are always called — `from pragma_table_info(...)` — and a
 * name followed by `(` is skipped as a subquery or table-valued function.
 */
const BUILT_IN = new Set(['sqlite_master', 'sqlite_schema', 'sqlite_temp_master']);

const ROOTS = ['src', 'scripts', 'e2e'];

function tsFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) tsFiles(path, out);
		else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path);
	}
	return out;
}

/**
 * The bodies of every `` sql`…` `` (and `` sql<T>`…` ``) template in one file.
 *
 * Hand-scanned rather than matched with a regex because these templates nest:
 * `sql.join` and `inArray` helpers put whole `` sql`…` `` fragments inside `${…}`,
 * and a non-greedy match to the next backtick would end the outer template at the
 * inner one's first backtick and then read the SQL that follows as prose.
 */
function sqlTemplates(source: string): { body: string; line: number }[] {
	const out: { body: string; line: number }[] = [];
	// The lookbehind matters: prose in a JSDoc block writes the word as a markdown
	// code span — "these predicates are raw `sql`" — which is literally `sql` followed
	// by a backtick, and without it the scanner reads the sentence after it as SQL.
	const opener = /(?<!`)\bsql(?:<[^>]*>)?`/g;
	let m: RegExpExecArray | null;
	while ((m = opener.exec(source))) {
		let i = m.index + m[0].length;
		let depth = 0; // depth of `${ … }` interpolation
		let body = '';
		for (; i < source.length; i++) {
			const c = source[i];
			if (c === '\\') {
				i++;
				continue;
			}
			if (depth === 0 && c === '`') break;
			if (c === '$' && source[i + 1] === '{') {
				depth++;
				i++;
				body += ' ? '; // an interpolation is a value or a table object, never a name we can read
				continue;
			}
			if (depth > 0) {
				if (c === '{') depth++;
				else if (c === '}') depth--;
				continue;
			}
			body += c;
		}
		out.push({ body, line: source.slice(0, m.index).split('\n').length });
		opener.lastIndex = i + 1;
	}
	return out;
}

/** Table names in `from` / `join` / `into` / `update` position, comments stripped. */
function tablesNamedIn(body: string): string[] {
	const sql = body.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
	const names: string[] = [];
	const ref = /\b(?:from|join|into|update)\s+(["'`]?)([A-Za-z_][A-Za-z0-9_]*)\1(\s*\()?/gi;
	let m: RegExpExecArray | null;
	while ((m = ref.exec(sql))) {
		if (m[3]) continue; // `from (select …)`, `from pragma_table_info(…)` — not a plain table
		names.push(m[2]);
	}
	return names;
}

describe('raw SQL table references', () => {
	const offenders: string[] = [];
	for (const root of ROOTS) {
		for (const file of tsFiles(root)) {
			const source = readFileSync(file, 'utf8');
			if (!source.includes('sql`') && !/\bsql</.test(source)) continue;
			for (const { body, line } of sqlTemplates(source)) {
				for (const name of tablesNamedIn(body)) {
					if (schemaTables.has(name) || BUILT_IN.has(name)) continue;
					offenders.push(`${file}:${line} → ${name}`);
				}
			}
		}
	}

	it('names only tables that exist in the current schema', () => {
		expect(offenders).toEqual([]);
	});

	// Guards the scanner itself: if the extraction quietly broke, the test above
	// would pass by checking nothing at all.
	it('finds the raw SQL it is meant to be checking', () => {
		let found = 0;
		for (const root of ROOTS) {
			for (const file of tsFiles(root)) {
				const source = readFileSync(file, 'utf8');
				if (!source.includes('sql`')) continue;
				for (const { body } of sqlTemplates(source)) found += tablesNamedIn(body).length;
			}
		}
		expect(found).toBeGreaterThan(5);
	});
});
