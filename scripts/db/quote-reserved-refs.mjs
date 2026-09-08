#!/usr/bin/env node
// Quotes reserved-word table names in the REFERENCES clause of ALTER TABLE ADD.
//
// THE PROBLEM
//
// drizzle-kit backticks table names everywhere except one place: the inline
// REFERENCES of an added column. It emits
//
//   ALTER TABLE `inbox_thread` ADD `group_id` text REFERENCES group(id) ...
//
// and `group` is a SQLite keyword, so the statement is a syntax error — the
// migration fails outright the first time it is applied. Every earlier ALTER of
// this shape in this repo happened to reference `user`, `event`, `project` and
// friends, none of which are reserved, which is why it took until the inbox
// gained a nullable group owner for anyone to hit it.
//
// The equivalent CREATE TABLE form is already correct: drizzle renders those
// FKs as a named CONSTRAINT with the table backticked. Only the ALTER path is
// affected, and only for a reserved word.
//
// THE FIX
//
// Backtick the table name. Nothing else about the statement changes, so the
// snapshot drizzle wrote stays accurate and a later `drizzle-kit generate`
// still sees no drift — this rewrites SQL that has not run yet, never a
// migration that has.
//
// USAGE
//   node scripts/db/quote-reserved-refs.mjs --check    # CI: fail on unquoted refs
//   node scripts/db/quote-reserved-refs.mjs --write    # rewrite in place

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';

// `REFERENCES <bare-identifier>(` — bare meaning drizzle did not quote it.
const UNQUOTED_REF = /\bREFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

// SQLite's keyword list, trimmed to words that could plausibly be a table name
// here. Quoting only what has to be quoted keeps the diff on a generated file
// as close to nothing as possible.
const RESERVED = new Set([
	'group',
	'order',
	'transaction',
	'index',
	'table',
	'view',
	'select',
	'where',
	'having',
	'values',
	'default',
	'check',
	'references',
	'constraint',
	'primary',
	'unique',
	'key',
	'plan',
	'range',
	'row',
	'rows',
	'filter',
	'window',
	'return'
]);

/** @param {string} sql */
function fix(sql) {
	return sql.replace(UNQUOTED_REF, (/** @type {string} */ match, /** @type {string} */ table) =>
		RESERVED.has(table.toLowerCase()) ? `REFERENCES \`${table}\`(` : match
	);
}

const mode = process.argv.includes('--check') ? 'check' : 'write';
const offenders = [];

for (const dir of readdirSync(MIGRATIONS_DIR).sort()) {
	const file = join(MIGRATIONS_DIR, dir, 'migration.sql');
	if (!existsSync(file)) continue;

	const sql = readFileSync(file, 'utf8');
	const fixed = fix(sql);
	if (fixed === sql) continue;

	offenders.push(dir);
	if (mode === 'write') writeFileSync(file, fixed);
}

if (offenders.length === 0) process.exit(0);

if (mode === 'write') {
	console.log(`quote-reserved-refs: quoted reserved table names in ${offenders.join(', ')}`);
	process.exit(0);
}

console.error(
	'A migration references a reserved table name unquoted, which SQLite rejects:\n' +
		offenders.map((d) => `  migrations/${d}/migration.sql`).join('\n') +
		"\n\nRun 'pnpm db:generate' and commit the result."
);
process.exit(1);
