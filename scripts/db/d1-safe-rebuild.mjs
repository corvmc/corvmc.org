#!/usr/bin/env node
// Rewrites drizzle-kit table rebuilds into a form that is safe on Cloudflare D1.
//
// THE PROBLEM
//
// When a change can't be expressed as ALTER TABLE (relaxing NOT NULL, changing
// an FK action, dropping a column on older SQLite), drizzle-kit emits a "table
// rebuild": create `__new_x`, copy, DROP TABLE `x`, rename. It wraps that in
// `PRAGMA foreign_keys=OFF` so the DROP doesn't cascade.
//
// On D1 that pragma is silently inert. D1 runs a migration inside a
// transaction, and SQLite documents `PRAGMA foreign_keys` as a no-op inside
// one — the statement is accepted, reports success, and the value never
// changes (verified: it reads back `1` immediately after being set to OFF).
// So `DROP TABLE x` performs its implicit DELETE, every ON DELETE CASCADE
// child loses its rows, and every ON DELETE SET NULL child is nulled. Silently.
//
// No pragma avoids this. `defer_foreign_keys` delays *reporting of violations*
// but does not stop FK *actions*. `legacy_alter_table` does register on D1, but
// preserving child references through a rename needs `foreign_keys=OFF` as
// well — the one pragma D1 won't honour.
//
// THE FIX (detach -> rebuild -> reattach)
//
// Stop trying to suppress the cascade and remove it instead. Rebuild each
// cascade child with its FK to the doomed parent demoted to NO ACTION, then
// rebuild the parent (whose DROP now cascades to nothing), then rebuild the
// children again with their real FK actions restored. `defer_foreign_keys`
// holds the transient violation — children briefly point at a parent that is
// being replaced — until COMMIT, by which time the parent is back.
//
// Credit: the detach/rebuild/reattach shape is from Timur Brachkow's writeup,
// https://www.brachkow.com/notes/d1-on-delete-cascade/ — this script automates
// it and derives the FK graph from drizzle's own snapshot.
//
// USAGE
//   node scripts/db/d1-safe-rebuild.mjs --check    # CI: fail on unsafe migrations
//   node scripts/db/d1-safe-rebuild.mjs --write    # rewrite unsafe migrations in place

/** @typedef {import('./snapshot-types.js').Snapshot} Snapshot */
/** @typedef {import('./snapshot-types.js').GroupedSnapshot} GroupedSnapshot */
/** @typedef {import('./snapshot-types.js').ChildGraph} ChildGraph */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	readSnapshot,
	childGraph,
	descendantsDeepestFirst,
	renderCreateTable,
	renderIndexes,
	columnList
} from './d1-ddl.mjs';

const MIGRATIONS_DIR = 'migrations';
const BREAK = '--> statement-breakpoint';
const SAFE_MARKER = 'd1-safe-rebuild';

// Migrations that predate this script. They have already been applied to
// production, so their SQL is history and must not be rewritten — editing an
// applied migration changes nothing in the database and desynchronises the
// migration record.
//
//   sloppy_apocalypse  rebuilt 28 tables early in the project's life
//   clumsy_post        rebuilt `reservation`
//   material_spiral    rebuilt `band`; already hand-fixed, using the older
//                      snapshot-and-restore shape (copy children to `_bk_`
//                      tables, then delete-and-refill). That is safe but is
//                      not the pattern this script emits, so the detector
//                      below doesn't recognise it.
//
// Nothing may be added here. A new migration that trips the check must be
// fixed with --write, not exempted.
const GRANDFATHERED = new Set([
	'20260524210008_sloppy_apocalypse',
	'20260526000329_clumsy_post',
	'20260604012148_material_spiral'
]);

/** Tables rebuilt by a migration, i.e. drizzle's `recreate_table` output. */
/** @param {string} sql @returns {string[]} */
export function findRebuiltTables(sql) {
	const out = [];
	// `__new_x` is created, then the real `x` is dropped and `__new_x` renamed
	// over it. Requiring the DROP is what distinguishes a rebuild from an
	// ordinary CREATE TABLE.
	for (const m of sql.matchAll(/CREATE TABLE `__new_([A-Za-z0-9_]+)`/g)) {
		const table = m[1];
		if (new RegExp(`DROP TABLE \`${table}\``).test(sql)) out.push(table);
	}
	return [...new Set(out)];
}

/**
 * Tables this migration *creates outright*, i.e. new tables rather than
 * rebuilds of existing ones.
 *
 * These must never be detached. A detach copies rows out of the table before
 * dropping it, but a table created by this same migration does not exist yet
 * when the detach block runs — the copy fails with "no such table". It also has
 * nothing worth preserving: it is empty, so the parent's DROP cascading into it
 * deletes nothing.
 */
/** @param {string} sql @returns {string[]} */
export function findCreatedTables(sql) {
	const out = [];
	for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`([A-Za-z0-9_]+)`/g)) {
		const table = m[1];
		// Skip drizzle's rebuild scratch tables and our own detach/reattach ones.
		if (/^__(new|detach|reattach)_/.test(table)) continue;
		out.push(table);
	}
	return [...new Set(out)];
}

/**
 * Any `DROP TABLE x` where `x` has foreign-key children, beyond the rebuilds
 * handled above.
 *
 * The rebuild detector keys off drizzle's `__new_` naming, so it only sees
 * migrations drizzle generated. A hand-written migration that drops a parent —
 * either to remove it for good, or via a rebuild using its own temp-table name —
 * destroys child rows on D1 in exactly the same way and would otherwise sail
 * through.
 *
 * These can't be auto-fixed: dropping a parent on purpose is legitimate, and
 * only the author knows which it is. So this is check-only, and the opt-out is
 * a comment naming the table, which keeps the decision visible in the diff:
 *
 *   -- d1-safe-rebuild: intentional drop `band`
 */
/**
 * @param {string} sql
 * @param {ChildGraph} kids
 * @param {string[]} [rebuilt]
 * @returns {string[]}
 */
export function findUnsafeDrops(sql, kids, rebuilt = []) {
	// A rewritten migration drops its children on purpose, as part of the
	// detach/reattach dance, and restores them before commit. Those drops are
	// safe by construction — without this, every correctly-rewritten migration
	// would fail the check.
	if (sql.includes(SAFE_MARKER)) return [];
	const out = [];
	for (const m of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?`([A-Za-z0-9_]+)`/gi)) {
		const table = m[1];
		if (rebuilt.includes(table)) continue; // the rewrite path already covers it
		if (/^__(new|detach|reattach)_/.test(table)) continue; // our own scratch tables
		if (!kids.get(table)?.size) continue; // no children, nothing can cascade
		if (new RegExp(`intentional drop\\s+\`?${table}\`?`, 'i').test(sql)) continue;
		out.push(table);
	}
	return [...new Set(out)];
}

/**
 * Split a migration into statements, dropping the pragma lines drizzle emits
 * around a rebuild — we supply our own framing.
 */
/** @param {string} sql @returns {string[]} */
function statements(sql) {
	return /** @type {string} */ (sql)
		.split(BREAK)
		.map((s) => s.trim())
		.filter(Boolean)
		.filter((s) => !/^PRAGMA\s+foreign_keys\s*=/i.test(s));
}

/** Rebuild `table` under a temporary name, then swap it in. */
/**
 * @param {GroupedSnapshot} snap
 * @param {string} table
 * @param {string} tmpPrefix
 * @param {Set<string>} demote
 */
function rebuildBlock(snap, table, tmpPrefix, demote) {
	const tmp = `${tmpPrefix}_${table}`;
	const cols = columnList(snap, table);
	return [
		renderCreateTable(snap, table, { as: tmp, demote }),
		`INSERT INTO \`${tmp}\`(${cols}) SELECT ${cols} FROM \`${table}\`;`,
		`DROP TABLE \`${table}\`;`,
		`ALTER TABLE \`${tmp}\` RENAME TO \`${table}\`;`,
		...renderIndexes(snap, table)
	];
}

/**
 * Rewrite one migration. Returns the new SQL, or null when nothing is needed.
 */
/**
 * @param {string} sql
 * @param {Snapshot} snapshot
 * @returns {string | null}
 */
export function rewriteMigration(sql, snapshot) {
	if (sql.includes(SAFE_MARKER)) return null; // already rewritten
	const rebuilt = findRebuiltTables(sql);
	if (!rebuilt.length) return null;

	const snap = readSnapshot(snapshot);
	const kids = childGraph(snap);

	// Only descendants that aren't themselves being rebuilt need detaching —
	// a table the migration already rebuilds gets its DDL from drizzle. Tables
	// this migration creates are skipped too: they don't exist when the detach
	// block runs, and they're empty, so there is nothing to protect.
	const rebuiltSet = new Set(rebuilt);
	const createdSet = new Set(findCreatedTables(sql));
	/** @type {string[]} */
	const toDetach = [];
	for (const table of rebuilt) {
		for (const d of descendantsDeepestFirst(table, kids)) {
			if (rebuiltSet.has(d) || createdSet.has(d)) continue;
			if (!toDetach.includes(d)) toDetach.push(d);
		}
	}
	if (!toDetach.length) return null; // nothing references these tables — drizzle's output is fine

	// Demote FKs pointing at anything that will be dropped: the rebuilt tables
	// themselves, plus the detached children (which are dropped in turn).
	const demote = new Set([...rebuilt, ...toDetach]);

	const out = [
		`-- ${SAFE_MARKER}: rewritten for Cloudflare D1.`,
		`-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so`,
		`-- drizzle's generated DROP TABLE would cascade-delete these children:`,
		`--   ${toDetach.join(', ')}`,
		`-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.`,
		`PRAGMA defer_foreign_keys=ON;`,
		...toDetach.flatMap((t) => [`-- detach ${t}`, ...rebuildBlock(snap, t, '__detach', demote)]),
		...statements(sql),
		...toDetach
			.slice()
			.reverse() // reattach top-down: a parent must be restored before its own children
			.flatMap((t) => [`-- reattach ${t}`, ...rebuildBlock(snap, t, '__reattach', new Set())]),
		`PRAGMA defer_foreign_keys=OFF;`
	];
	return out.join(`\n${BREAK}\n`) + '\n';
}

/**
 * Merge comment-only chunks into the statement that follows them.
 *
 * `drizzle-kit migrate` POSTs each `--> statement-breakpoint` chunk to D1 as a
 * single statement, and a chunk holding only comments has none — D1 rejects the
 * whole migration with `7500: SQL code did not contain a statement`. Comments
 * are fine; they just have to travel with the statement they describe.
 *
 * Runs over every migration, including ones already carrying the SAFE_MARKER
 * and hand-written ones (a hand-written file is what broke the production
 * deploy), so `pnpm db:fix-migrations` repairs the class wherever it appears.
 * Idempotent. Returns null when nothing needs moving.
 */
/** @param {string} sql @returns {string | null} */
export function collapseCommentOnlyChunks(sql) {
	/** @param {string} chunk */
	const isCommentOnly = (chunk) =>
		chunk
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('--')).length === 0;

	const chunks = sql.split(BREAK);
	if (!chunks.some(isCommentOnly)) return null;

	const out = [];
	let pending = [];
	for (const chunk of chunks) {
		if (isCommentOnly(chunk)) {
			const text = chunk.trim();
			if (text) pending.push(text);
			continue;
		}
		out.push(pending.length ? `${pending.join('\n')}\n${chunk.trim()}` : chunk.trim());
		pending = [];
	}

	// Nothing executable at all — not ours to rewrite.
	if (!out.length) return null;
	// Trailing comments have no following statement; park them on the last one.
	if (pending.length) out[out.length - 1] += `\n${pending.join('\n')}`;

	return out.join(`\n${BREAK}\n`) + '\n';
}

function migrationDirs() {
	return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
}

function main() {
	const write = process.argv.includes('--write');
	const check = process.argv.includes('--check');
	if (!write && !check) {
		console.error('usage: d1-safe-rebuild.mjs (--check | --write)');
		process.exit(2);
	}

	const unsafeRebuilds = [];
	const unsafeDrops = [];
	const commentOnly = [];
	let pruned = 0;
	for (const dir of migrationDirs()) {
		if (GRANDFATHERED.has(dir)) continue;
		const sqlPath = join(MIGRATIONS_DIR, dir, 'migration.sql');
		const snapPath = join(MIGRATIONS_DIR, dir, 'snapshot.json');
		if (!existsSync(sqlPath)) continue;
		// No snapshot means `scripts/db/prune-snapshots.mjs` has been here, which it only does
		// to a migration that is already on `origin/main`. That SQL is history: it has been
		// applied, editing it would desynchronise the migration record, and there is nothing
		// this script could usefully do to it. Counted rather than passed over in silence, so
		// that a *new* migration arriving without a snapshot still reads as wrong.
		if (!existsSync(snapPath)) {
			pruned++;
			continue;
		}

		const sql = readFileSync(sqlPath, 'utf8');
		const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
		const rewritten = rewriteMigration(sql, snapshot);

		if (rewritten && write) {
			console.log(`rewritten: ${dir}`);
		} else if (rewritten) {
			unsafeRebuilds.push(dir);
		}

		// Comment placement is repaired after the rebuild rewrite so it also
		// covers the rewrite's own output, and independently of SAFE_MARKER so
		// already-rewritten and hand-written migrations are both reachable.
		let repaired = rewritten && write ? rewritten : sql;
		const collapsed = collapseCommentOnlyChunks(repaired);
		if (collapsed && write) {
			repaired = collapsed;
			console.log(`comments merged onto their statements: ${dir}`);
		} else if (collapsed) {
			commentOnly.push(dir);
		}

		if (write && repaired !== sql) writeFileSync(sqlPath, repaired);

		// Checked against the post-rewrite SQL so the rewrite's own drops don't
		// register. --write can't repair these, so they're reported in both modes.
		const finalSql = repaired;
		const kids = childGraph(readSnapshot(snapshot));
		const drops = findUnsafeDrops(finalSql, kids, findRebuiltTables(finalSql));
		if (drops.length) unsafeDrops.push({ dir, drops });
	}

	if (pruned) {
		console.log(
			`skipped ${pruned} applied migration(s) whose snapshot has been pruned — their SQL is history.`
		);
	}

	if (unsafeRebuilds.length) {
		console.error(
			'\nUnsafe table rebuilds found — these would silently delete child rows on D1:\n'
		);
		for (const d of unsafeRebuilds) console.error(`  migrations/${d}/migration.sql`);
		console.error('\nFix with:  pnpm db:fix-migrations');
	}

	if (unsafeDrops.length) {
		console.error('\nDROP TABLE on a table with foreign-key children:\n');
		for (const { dir, drops } of unsafeDrops) {
			console.error(`  migrations/${dir}/migration.sql -> ${drops.join(', ')}`);
		}
		console.error(
			'\nOn D1 this cascade-deletes their child rows. Either rebuild using the\n' +
				'detach/reattach shape (see the header of scripts/db/d1-safe-rebuild.mjs),\n' +
				'or, if the table really is being removed for good, mark it in the migration:\n' +
				'  -- d1-safe-rebuild: intentional drop `<table>`'
		);
	}

	if (commentOnly.length) {
		console.error('\nComment-only chunks found — D1 rejects these with 7500:\n');
		for (const d of commentOnly) console.error(`  migrations/${d}/migration.sql`);
		console.error('\nFix with:  pnpm db:fix-migrations');
	}

	if (unsafeRebuilds.length || unsafeDrops.length || commentOnly.length) {
		console.error('');
		process.exit(1);
	}
	if (check) console.log('No unsafe table rebuilds or drops.');
}

// Only run when invoked directly, so the functions above stay unit-testable.
if (process.argv[1] && process.argv[1].endsWith('d1-safe-rebuild.mjs')) main();
