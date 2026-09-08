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
 * Leaving the schema in place is what makes a state directory outlive the run
 * that built it, so this file also owns the one case where that is not safe:
 * `journalDisagreesWithSchema` / `clearE2eStateDir` drop the directory outright
 * when its tables and drizzle's migration journal have come apart.
 *
 * D1 only. KV is deliberately left alone: the rate-limit counters that matter
 * are deleted by the fixtures that own them (`band-slug`, `suggestion-flag`,
 * `dm-request`, `dm-send`), and reaching the rest means writing against
 * miniflare's internal KV layout, which is fragile for no observed problem.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { E2E_PERSIST_PATH, E2E_STATE_ROOT, e2eD1File } from './state-dir';
import { tableOrder, deleteOrder } from '../scripts/d1-table-order.mjs';

/**
 * Delete every application row, child-first.
 *
 * `tableOrder` (parents → children) is hand-maintained, and
 * `scripts/d1-table-order.spec.ts` holds it to the drizzle snapshot — a table
 * added to the schema without being added there turns the unit suite red, so
 * this can't silently start missing one. `scripts/seed-dev.ts` derives its own
 * wipe from the same list, through `deleteOrder`; the Postgres ETL that also
 * read it was deleted once D1 became canonical.
 *
 * Tables the list names but the database doesn't have are skipped rather than
 * thrown on: a database built from an older migration set is a normal thing to
 * find here.
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

	const cleared: string[] = deleteOrder(present);

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

/**
 * Whether the state directory's schema and drizzle's migration journal disagree.
 *
 * `resetE2eDatabase` empties tables; it does not drop them, deliberately — the
 * schema is expensive to rebuild and `migrateLocal` is incremental. That holds
 * as long as `__drizzle_migrations` still describes the tables that are there.
 * When it does not — a directory built before this repo moved to drizzle's own
 * migrator, or one whose journal was lost while its tables survived — the next
 * `migrateLocal` replays from migration 1 into a schema that already has those
 * tables and dies on the first `CREATE TABLE`:
 *
 *   DrizzleError: Failed to run the query 'CREATE TABLE `account` (…
 *     [cause]: Error: table account already exists
 *
 * — which reaches a `wrangler` caller as the bare `SQL logic error` that names
 * nothing.
 *
 * Nothing in the run recovers from that, because the migrator's transaction
 * rolls back and leaves the same directory behind for the next attempt to trip
 * over. `rm -rf .wrangler/e2e-state` was the only way out; this is that, made
 * automatic and narrow — the one shape of disagreement that is detectable
 * before it throws.
 *
 * @param db an open handle on the run's D1 file.
 */
export function journalDisagreesWithSchema(db: DatabaseSync): boolean {
	const tables = new Set(
		db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
			.all()
			.map((row) => String(row.name))
	);

	// An empty directory is not a stale one — the first run builds it from here.
	if (!(tableOrder as string[]).some((table) => tables.has(table))) return false;

	if (!tables.has('__drizzle_migrations')) return true;

	const row = db.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number };
	return Number(row.c) === 0;
}

/** `journalDisagreesWithSchema` against the run's own state directory. */
export function e2eStateIsStale(): boolean {
	if (!existsSync(join(E2E_PERSIST_PATH, 'd1'))) return false;

	let file: string;
	try {
		file = e2eD1File();
	} catch {
		// No single D1 file to read: miniflare's layout is not what this expects,
		// so there is nothing here worth migrating into.
		return true;
	}

	const db = new DatabaseSync(file, { timeout: 5_000 });
	try {
		return journalDisagreesWithSchema(db);
	} finally {
		db.close();
	}
}

/**
 * Delete the run's state directory outright.
 *
 * Costs the next run a full migrate, which is why this is not the ordinary
 * cleanup — `resetE2eDatabase` is. Reach for it only when the directory cannot
 * be migrated into at all.
 *
 * @returns false when there was no directory to delete.
 */
export function clearE2eStateDir(): boolean {
	// The same guard `resetE2eDatabase` carries, for the same reason: a refactor
	// that pointed `E2E_STATE_ROOT` at `.wrangler/state` would delete the
	// database `pnpm dev` and every wrangler command use.
	if (basename(E2E_STATE_ROOT) !== 'e2e-state') {
		throw new Error(`Refusing to delete ${E2E_STATE_ROOT}: not the e2e state directory.`);
	}
	if (!existsSync(E2E_STATE_ROOT)) return false;

	rmSync(E2E_STATE_ROOT, { recursive: true, force: true });
	return true;
}

/**
 * Fold the write-ahead log back into the database file.
 *
 * The preview server opens D1 through workerd, and workerd opens it *lazily, on
 * the first request* — by which time Playwright has already started its workers,
 * and each of those opens its own `readLocalDb` reader. If the file still has a
 * WAL to replay at that moment, workerd needs an exclusive lock to recover it,
 * the readers' shared locks deny it, and it does not retry — it dies, taking the
 * whole suite with it rather than one test:
 *
 *   *** Fatal uncaught kj::Exception: SENTRY_DO SQLite failed;
 *       database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)
 *
 * Observed on run 33113081800: 61 of 61 tests failed this way, on a shard that
 * did not even build (so that instance was purely recovery racing the readers).
 *
 * **Called twice, and both are necessary.** `e2e/prepare.ts` calls it last,
 * after every seed has written and its miniflare has gone — that clears the WAL
 * the seeds leave. `e2e/checkpoint.ts` calls it again between `pnpm build` and
 * `pnpm preview`, because the build leaves one too: `adapter-cloudflare`'s
 * `emulate()` hook calls `getPlatformProxy`, which opens this same file and
 * never disposes it. Only the first call existed for a while, and the race kept
 * happening — five merge-queue ejections' worth — because the build recreated
 * what prepare had just cleared.
 *
 * TRUNCATE rather than PASSIVE: it resets the WAL to zero length, so there is
 * nothing left for workerd to recover.
 *
 * **Every SQLite under the persist path, not only D1.** miniflare keeps one
 * database per storage kind, and `getPlatformProxy` opens all of them — so a
 * build leaves a WAL beside each. A freshly seeded state directory here has six:
 * two for D1 (the database and its metadata), two for R2, one for KV and one for
 * the cache. Checkpointing only D1 closed one of six windows, which is why the
 * race survived #360: the failure that started this names `SENTRY_DO`, not D1,
 * and no amount of checkpointing D1 was ever going to reach it.
 *
 * Failures are swallowed per file. A database workerd already holds open is one
 * this cannot help with, and throwing here would turn a missed optimisation into
 * a failed run — the caller is `prepare.ts` and `checkpoint.ts`, neither of which
 * has anything better to do about it than carry on.
 *
 * @returns which files ended up with no WAL, and which did not.
 */
export function checkpointE2eDatabase(): SqliteCheckpoint {
	if (!existsSync(E2E_PERSIST_PATH)) return { checkpointed: [], busy: [], failed: [] };

	// Same guard as `resetE2eDatabase`: only ever touch this suite's own state. A
	// stray absolute path here would checkpoint `.wrangler/state`, which `pnpm dev`
	// may be holding.
	return checkpointSqliteFiles(
		sqliteFilesUnder(E2E_PERSIST_PATH).filter((file) => file.startsWith(E2E_PERSIST_PATH))
	);
}

/** What a sweep did, file by file. */
export interface SqliteCheckpoint {
	/** Files whose WAL is now gone — nothing left for workerd to recover. */
	checkpointed: string[];
	/** Files something else still held. Their WAL survives. */
	busy: string[];
	/** Files that could not be opened at all. */
	failed: string[];
}

/**
 * TRUNCATE-checkpoint each file, and say which ones actually ended up without a WAL.
 *
 * **Reading the result row is the point.** `PRAGMA wal_checkpoint(TRUNCATE)` does
 * not throw when it cannot take the exclusive lock — it answers `busy: 1` and
 * leaves the WAL exactly as it was. `db.exec` discards that row, so the sweep could
 * truncate nothing and still report success, which is how `e2e/checkpoint.ts` came
 * to print "Checkpointed the e2e database after the build." into the one CI log
 * somebody reads when the suite has died on a server that never came up. A
 * surviving WAL is the entire failure mode, so whether one survived is the only
 * output worth having.
 *
 * Nothing here throws or retries, keeping #509's contract: a database workerd
 * already holds is not one this can help with, and failing the run over it would
 * turn a missed optimisation into a red suite. The caller reports; it does not act.
 *
 * Takes the files rather than finding them so the outcomes above can be exercised
 * against a scratch database — `checkpointE2eDatabase` is what binds it to the run.
 */
export function checkpointSqliteFiles(
	files: string[],
	{ timeoutMs = 5_000 } = {}
): SqliteCheckpoint {
	const swept: SqliteCheckpoint = { checkpointed: [], busy: [], failed: [] };

	for (const file of files) {
		try {
			const db = new DatabaseSync(file, { timeout: timeoutMs });
			try {
				const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
					{ busy?: number } | undefined;
				(row?.busy ? swept.busy : swept.checkpointed).push(file);
			} finally {
				db.close();
			}
		} catch {
			swept.failed.push(file);
		}
	}

	return swept;
}

/**
 * One line for a log, saying plainly whether anything was left behind.
 *
 * The failure this exists to prevent presents as "the diff broke everything" — a
 * suite where nothing came up and no test output was produced — so the log has to
 * be readable by somebody who does not yet know that is what they are looking at.
 */
export function checkpointSummary(swept: SqliteCheckpoint): string {
	const stuck = [...swept.busy, ...swept.failed];

	if (stuck.length === 0) {
		return swept.checkpointed.length === 0
			? 'No e2e database to checkpoint — nothing to do.'
			: `Checkpointed ${swept.checkpointed.length} e2e database(s); no WAL left behind.`;
	}

	return (
		`WARNING: ${stuck.length} of ${swept.checkpointed.length + stuck.length} e2e database(s) ` +
		`still hold a WAL: ${stuck.map((file) => basename(file)).join(', ')}.\n` +
		'workerd recovers a WAL lazily, on the first request, by which time ' +
		"Playwright's readers already hold the file — and it does not retry.\n" +
		'A suite that dies next with SQLITE_BUSY_RECOVERY and no test output died of this.'
	);
}

/**
 * Every `*.sqlite` under a miniflare persist directory.
 *
 * Walked rather than named: the layout is miniflare's
 * (`<kind>/miniflare-<Kind>Object/<hash|metadata>.sqlite`), the hashed filenames
 * are derived from binding names, and a new binding adds a directory nobody here
 * would remember to list. `-wal` and `-shm` are siblings of these, not separate
 * databases, so matching the `.sqlite` suffix alone is right.
 */
export function sqliteFilesUnder(dir: string): string[] {
	const out: string[] = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
		else if (entry.isFile() && entry.name.endsWith('.sqlite')) out.push(full);
	}

	return out;
}

// `tsx e2e/reset-db.ts` — clear the database by hand, e.g. after a failing run
// that was left intact for inspection.
//
// Emptying the tables is not always enough, and the case where it is not used to
// send people to `rm -rf .wrangler/e2e-state` by hand: see
// `journalDisagreesWithSchema`. Do that here instead, so the advice `e2e/run.ts`
// prints is true for every state this can be run against.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (e2eStateIsStale()) {
		clearE2eStateDir();
		console.log(
			"Dropped .wrangler/e2e-state: its schema and drizzle's migration journal disagreed," +
				'\nso clearing rows would have left a directory the next run cannot migrate.' +
				'\nThe next run rebuilds it.'
		);
	} else {
		console.log(
			resetE2eDatabase()
				? 'Cleared the e2e database.'
				: 'No e2e state directory — nothing to clear.'
		);
	}
}
