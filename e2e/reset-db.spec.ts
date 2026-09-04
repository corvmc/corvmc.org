/**
 * The reset is the only thing standing between a run and the previous run's
 * rows, and it is derived entirely from `tableOrder` — so what needs proving is
 * that it deletes from the tables it names, in an order foreign keys accept,
 * and that a name the database does not have costs nothing.
 *
 * `scripts/d1-table-order.spec.ts` covers the other half: that the list itself
 * still matches the drizzle schema.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	checkpointSqliteFiles,
	checkpointSummary,
	clearAllTables,
	journalDisagreesWithSchema,
	sqliteFilesUnder
} from './reset-db';

/** Two real tables from `tableOrder`, in a real parent → child relationship. */
function seededDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE "user" (id TEXT PRIMARY KEY);
		CREATE TABLE "session" (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES "user"(id)
		);
		CREATE TABLE "not_in_the_order" (id TEXT PRIMARY KEY);
		INSERT INTO "user" (id) VALUES ('u1');
		INSERT INTO "session" (id, user_id) VALUES ('s1', 'u1');
		INSERT INTO "not_in_the_order" (id) VALUES ('x1');
	`);
	return db;
}

function count(db: DatabaseSync, table: string): number {
	return Number((db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c);
}

describe('clearAllTables', () => {
	it('empties the tables it names, parent and child alike', () => {
		const db = seededDb();
		try {
			clearAllTables(db);
			expect([count(db, 'user'), count(db, 'session')]).toEqual([0, 0]);
		} finally {
			db.close();
		}
	});

	it('reports only the tables the database actually has', () => {
		const db = seededDb();
		try {
			const cleared = clearAllTables(db);
			expect(cleared.sort()).toEqual(['session', 'user']);
		} finally {
			db.close();
		}
	});

	it('leaves a table the order does not name alone', () => {
		const db = seededDb();
		try {
			clearAllTables(db);
			expect(count(db, 'not_in_the_order')).toBe(1);
		} finally {
			db.close();
		}
	});

	it('restores foreign key enforcement afterwards', () => {
		const db = seededDb();
		try {
			clearAllTables(db);
			expect(() =>
				db.exec(`INSERT INTO "session" (id, user_id) VALUES ('s2', 'nobody')`)
			).toThrow();
		} finally {
			db.close();
		}
	});
});

/**
 * A schema the journal does not account for.
 *
 * `resetE2eDatabase` empties tables and leaves them standing, so a state
 * directory outlives the run that built it. That is only safe while
 * `__drizzle_migrations` still describes the tables that are there — otherwise
 * the next `migrateLocal` replays migration 1 into a schema that already has
 * `account` and dies, and the rollback hands the same directory to the run after
 * it. Encountered twice on #297, recoverable only by deleting the directory.
 */
describe('journalDisagreesWithSchema', () => {
	function check(sql?: string): boolean {
		const handle = new DatabaseSync(':memory:');
		try {
			if (sql) handle.exec(sql);
			return journalDisagreesWithSchema(handle);
		} finally {
			handle.close();
		}
	}

	it('is false for an empty directory — the first run builds it', () => {
		expect(check()).toBe(false);
	});

	it('is false when the journal accounts for the schema', () => {
		expect(
			check(`
				CREATE TABLE "user" (id TEXT PRIMARY KEY);
				CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT);
				INSERT INTO __drizzle_migrations (hash) VALUES ('0000_initial');
			`)
		).toBe(false);
	});

	it('is true when the tables are there and the journal table is not', () => {
		expect(check('CREATE TABLE "user" (id TEXT PRIMARY KEY);')).toBe(true);
	});

	it('is true when the journal table is there but empty', () => {
		expect(
			check(`
				CREATE TABLE "user" (id TEXT PRIMARY KEY);
				CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT);
			`)
		).toBe(true);
	});

	it('ignores tables the schema does not own, so a bare journal is not stale', () => {
		// miniflare keeps its own bookkeeping in the same file. Only a table
		// `tableOrder` names counts as "the schema is already here".
		expect(check('CREATE TABLE "not_in_the_order" (id TEXT PRIMARY KEY);')).toBe(false);
	});
});

/**
 * The checkpoint's file discovery.
 *
 * miniflare keeps one SQLite per storage kind, so a build leaves a WAL beside
 * each — six of them in a seeded state directory. Checkpointing only D1 left
 * five windows open, and the failure that closed them named `SENTRY_DO` rather
 * than D1, so no amount of work on the D1 file would ever have reached it.
 * What has to hold is that the walk finds every database and nothing else.
 */
describe('sqliteFilesUnder', () => {
	/** miniflare's real layout: `<kind>/miniflare-<Kind>Object/<name>.sqlite`. */
	function persistDir(): string {
		const root = mkdtempSync(join(tmpdir(), 'e2e-persist-'));
		for (const [kind, object] of [
			['d1', 'miniflare-D1DatabaseObject'],
			['kv', 'miniflare-KVNamespaceObject'],
			['r2', 'miniflare-R2BucketObject'],
			['cache', 'miniflare-CacheObject']
		]) {
			const dir = join(root, kind, object);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'metadata.sqlite'), '');
			// The hashed per-binding database, and the WAL/SHM siblings that are
			// part of it rather than databases of their own.
			writeFileSync(join(dir, 'deadbeef.sqlite'), '');
			writeFileSync(join(dir, 'deadbeef.sqlite-wal'), '');
			writeFileSync(join(dir, 'deadbeef.sqlite-shm'), '');
		}
		return root;
	}

	it('finds every database, across all four storage kinds', () => {
		const found = sqliteFilesUnder(persistDir());

		expect(found).toHaveLength(8);
		for (const kind of ['d1', 'kv', 'r2', 'cache']) {
			expect(found.filter((f) => f.includes(`/${kind}/`))).toHaveLength(2);
		}
	});

	// `-wal` and `-shm` are siblings of a database, not databases. Opening one
	// as though it were is how a checkpoint corrupts what it meant to protect.
	it('takes only .sqlite, never its -wal or -shm siblings', () => {
		const found = sqliteFilesUnder(persistDir());

		expect(found.every((f) => f.endsWith('.sqlite'))).toBe(true);
		expect(found.some((f) => f.endsWith('-wal') || f.endsWith('-shm'))).toBe(false);
	});

	// The layout is miniflare's, and a new binding adds a directory nobody would
	// remember to add to a hand-written list. Recursion is what makes that safe.
	it('reaches a database nested deeper than the known layout', () => {
		const root = persistDir();
		const deep = join(root, 'do', 'miniflare-DurableObject', 'nested');
		mkdirSync(deep, { recursive: true });
		writeFileSync(join(deep, 'sentry.sqlite'), '');

		expect(sqliteFilesUnder(root).some((f) => f.endsWith('sentry.sqlite'))).toBe(true);
	});

	it('returns nothing for an empty directory rather than throwing', () => {
		expect(sqliteFilesUnder(mkdtempSync(join(tmpdir(), 'e2e-empty-')))).toEqual([]);
	});
});

/**
 * Whether the checkpoint actually happened, as opposed to whether it was tried.
 *
 * `PRAGMA wal_checkpoint(TRUNCATE)` does not throw when it cannot take the
 * exclusive lock. It answers a row with `busy: 1` and leaves the WAL exactly where
 * it was, so a `db.exec` that ignores the row cannot tell the two apart — which is
 * how the step came to print "Checkpointed the e2e database after the build" into
 * the one CI log somebody reads when the suite has died on a server that never
 * came up.
 *
 * A surviving WAL is the whole failure mode: workerd recovers one lazily, on the
 * first request, by which time Playwright's readers hold the file, and it does not
 * retry. So "which files still have a WAL" is the only output worth having.
 */
describe('checkpointSqliteFiles', () => {
	const open: DatabaseSync[] = [];
	const roots: string[] = [];

	afterEach(() => {
		for (const db of open.splice(0)) db.close();
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	/**
	 * A database left with a WAL on disk.
	 *
	 * Closing the last connection checkpoints and deletes the WAL, so a fixture
	 * that wants one has to hold the database open — idle, with no read
	 * transaction, which is the state the build's undisposed `getPlatformProxy`
	 * miniflare leaves behind.
	 */
	function withWal(name = 'db.sqlite'): string {
		const root = mkdtempSync(join(tmpdir(), 'e2e-checkpoint-'));
		roots.push(root);
		const file = join(root, name);
		const db = new DatabaseSync(file);
		db.exec('PRAGMA journal_mode = WAL');
		db.exec('CREATE TABLE t (id INTEGER)');
		db.exec('INSERT INTO t VALUES (1)');
		open.push(db);
		return file;
	}

	function walBytes(file: string): number {
		return existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0;
	}

	it('truncates the WAL and reports the file as checkpointed', () => {
		const file = withWal();
		expect(walBytes(file)).toBeGreaterThan(0);

		const swept = checkpointSqliteFiles([file]);

		expect([walBytes(file), swept.checkpointed]).toEqual([0, [file]]);
	});

	it('reports a file it could not truncate as busy, not as a success', () => {
		const file = withWal();
		// A reader holding an open snapshot denies the exclusive lock — the same
		// shape as Playwright's workers reading while workerd boots.
		const reader = new DatabaseSync(file, { readOnly: true });
		open.push(reader);
		reader.exec('BEGIN');
		reader.prepare('SELECT * FROM t').all();

		const swept = checkpointSqliteFiles([file], { timeoutMs: 250 });

		expect({ busy: swept.busy, checkpointed: swept.checkpointed }).toEqual({
			busy: [file],
			checkpointed: []
		});
	});

	it('leaves the WAL in place when it reports busy, rather than claiming otherwise', () => {
		const file = withWal();
		const reader = new DatabaseSync(file, { readOnly: true });
		open.push(reader);
		reader.exec('BEGIN');
		reader.prepare('SELECT * FROM t').all();

		checkpointSqliteFiles([file], { timeoutMs: 250 });

		expect(walBytes(file)).toBeGreaterThan(0);
	});

	it('records a file it could not open at all without throwing', () => {
		// #509's fail-open contract: one workerd already holds is not one this can
		// help with, and throwing would turn a missed optimisation into a failed run.
		const root = mkdtempSync(join(tmpdir(), 'e2e-checkpoint-bad-'));
		roots.push(root);
		const file = join(root, 'not-a-database.sqlite');
		writeFileSync(file, 'this is not sqlite');

		expect(checkpointSqliteFiles([file]).failed).toEqual([file]);
	});

	it('is empty for no files at all', () => {
		expect(checkpointSqliteFiles([])).toEqual({ checkpointed: [], busy: [], failed: [] });
	});
});

/**
 * The line a person reads at 3am, when the suite has died with no test output and
 * the obvious conclusion is that the diff broke everything. It has to distinguish
 * "swept clean" from "gave up", because only the second explains what follows.
 */
describe('checkpointSummary', () => {
	it('says nothing alarming when every WAL is gone', () => {
		const line = checkpointSummary({ checkpointed: ['/a.sqlite'], busy: [], failed: [] });

		expect(line).not.toContain('WARNING');
	});

	it('warns and names the file when a WAL survived', () => {
		const line = checkpointSummary({
			checkpointed: ['/a.sqlite'],
			busy: ['/state/kv/held.sqlite'],
			failed: []
		});

		expect(line).toContain('WARNING');
		expect(line).toContain('held.sqlite');
	});

	it('counts a file it could not open among the ones left holding a WAL', () => {
		const line = checkpointSummary({ checkpointed: [], busy: [], failed: ['/broken.sqlite'] });

		expect(line).toContain('1 of 1');
	});

	it('names the failure mode, so the next symptom is recognisable', () => {
		const line = checkpointSummary({ checkpointed: [], busy: ['/a.sqlite'], failed: [] });

		expect(line).toContain('SQLITE_BUSY_RECOVERY');
	});

	it('reports an empty state directory as nothing to do', () => {
		expect(checkpointSummary({ checkpointed: [], busy: [], failed: [] })).toContain(
			'nothing to do'
		);
	});
});
