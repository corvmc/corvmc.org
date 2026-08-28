/**
 * The reset is the only thing standing between a run and the previous run's
 * rows, and it is derived entirely from `tableOrder` — so what needs proving is
 * that it deletes from the tables it names, in an order foreign keys accept,
 * and that a name the database does not have costs nothing.
 *
 * `scripts/d1-table-order.spec.ts` covers the other half: that the list itself
 * still matches the drizzle schema.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { clearAllTables, journalDisagreesWithSchema } from './reset-db';

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
