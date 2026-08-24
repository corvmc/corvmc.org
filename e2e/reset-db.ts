/**
 * Empty the e2e run's local D1, leaving the schema in place.
 *
 * The suite's fixtures each open with an idempotent delete block, so a run
 * always *starts* from known data. What that model does not give is a clean
 * database *after* the run: everything the seeds wrote, everything the UI tests
 * wrote, and — the part no fixture owns — the `session` and `verification` rows
 * every login creates, the `notification` rows the app writes as a side effect,
 * and the `roles` rows `ensureRole` upserts. Those survived until the migration
 * list changed and `e2e/prepare.ts` rebuilt the whole state directory, which
 * could be dozens of runs.
 *
 * Clearing every table is safe here in a way it would not be anywhere else: the
 * e2e state directory (`e2e/state-dir.ts`) holds nothing but e2e data. `pnpm
 * dev`, `db:seed` and `db:reset` all use `.wrangler/state`, a different
 * directory, and nothing else ever seeds this one.
 *
 * Two callers, both at points where no workerd is holding the file:
 *
 *   - `e2e/prepare.ts`, before the preview server exists. This is what makes the
 *     guarantee survive a crash or a deliberately-kept failing run.
 *   - `e2e/run.ts`, after `playwright test` has exited and taken its preview
 *     server with it. Best-effort there — see the note in that file.
 *
 * Not `globalTeardown`: Playwright tears plugins (the `webServer`) down *after*
 * global teardown, so a write from there would land on files the preview server
 * still holds — the `SQLITE_BUSY` overlap the whole `prepare.ts` split exists to
 * avoid.
 *
 * D1 only. KV is deliberately left alone: the rate-limit counters that matter
 * are deleted by the fixtures that own them (`band-slug`, `suggestion-flag`,
 * `dm-request`, `dm-send`), and reaching the rest means writing against
 * miniflare's internal KV layout, which is fragile for no observed problem.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { E2E_PERSIST_PATH, e2eD1File } from './state-dir';
// @ts-expect-error -- plain .mjs helper, no types
import { tableOrder } from '../scripts/d1-table-order.mjs';

/**
 * Delete every application row, child-first.
 *
 * `tableOrder` (parents → children) is the same hand-maintained list
 * `scripts/gen-d1-delete.mjs` derives the production wipe from, and
 * `scripts/d1-table-order.spec.ts` holds it to the drizzle snapshot — a table
 * added to the schema without being added there turns the unit suite red, so
 * this can't silently start missing one.
 *
 * Tables the list names but the database doesn't have are skipped rather than
 * thrown on: `product_config` is in the list because it was dropped from the
 * schema without a `DROP TABLE`, and a database built from an older migration
 * set is a normal thing to find here.
 *
 * Foreign keys go off for the loop. The order is already correct — belt and
 * braces so a cleanup can never half-succeed and leave the next run seeding
 * into a partly-populated database.
 *
 * @returns the tables that were actually cleared.
 */
export function clearAllTables(db: DatabaseSync): string[] {
	const present = new Set(
		db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
			.all()
			.map((row) => String(row.name))
	);

	const cleared = ([...tableOrder] as string[]).reverse().filter((table) => present.has(table));

	db.exec('PRAGMA foreign_keys = OFF');
	try {
		for (const table of cleared) db.exec(`DELETE FROM "${table}"`);
	} finally {
		db.exec('PRAGMA foreign_keys = ON');
	}

	return cleared;
}

/**
 * Clear the e2e database in place.
 *
 * Writes through `node:sqlite` rather than `getPlatformProxy`, as `readLocalDb`
 * does: opening the file directly starts no second workerd over the state
 * directory, which is the failure mode this suite is built around.
 *
 * @returns false when there is no database to clear yet.
 */
export function resetE2eDatabase(): boolean {
	// Nothing has been migrated into this checkout yet — the first `pnpm test:e2e`
	// is about to build it.
	if (!existsSync(join(E2E_PERSIST_PATH, 'd1'))) return false;

	const file = e2eD1File();
	// The one path this is allowed to empty. A future refactor that pointed
	// `e2eD1File` at `.wrangler/state` would wipe the dev database instead.
	if (!file.startsWith(E2E_PERSIST_PATH)) {
		throw new Error(`Refusing to reset ${file}: outside the e2e state directory.`);
	}

	const db = new DatabaseSync(file, { timeout: 5_000 });
	try {
		clearAllTables(db);
	} finally {
		db.close();
	}
	return true;
}

// `tsx e2e/reset-db.ts` — clear the database by hand, e.g. after a failing run
// that was left intact for inspection.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(
		resetE2eDatabase() ? 'Cleared the e2e database.' : 'No e2e state directory — nothing to clear.'
	);
}
