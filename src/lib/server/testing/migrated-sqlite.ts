import { readFileSync, globSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

/**
 * An in-memory SQLite built by replaying every committed migration.
 *
 * A spec that aggregates in SQL has to run against the real schema: a mocked
 * `db` agrees with a `WHERE` whether or not it is there. Replaying is what
 * `db:migrate:local` does, so it survives the three things lifting one table's
 * `CREATE` out of the migrations does not (#847):
 *
 * - **Renames.** `event` became `event_listing`, so no migration carries a
 *   CREATE under the current name.
 * - **Rebuilds.** Drizzle's `__new_x` → copy → drop → rename leaves the newest
 *   CREATE for `x` under another name; picking `x`'s own builds a stale shape
 *   and fails later with `no such column`, which is the bad kind of wrong.
 * - **Indexes.** `onConflictDoUpdate` needs the unique index to exist, or
 *   SQLite reports a query that does not match any constraint.
 */
export function migratedSqlite(opts: { foreignKeys?: boolean } = {}) {
	const sqlite = new Database(':memory:');

	for (const file of globSync('migrations/*/migration.sql').sort()) {
		for (const statement of readFileSync(file, 'utf8')
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter(Boolean)) {
			sqlite.exec(statement);
		}
	}

	// After the replay, never before: a table rebuild turns this pragma back on
	// as its last statement, so setting it first is silently undone.
	sqlite.pragma(`foreign_keys = ${opts.foreignKeys ? 'ON' : 'OFF'}`);

	// `drizzle({ client })`, not `drizzle(client)`. drizzle 1.0 dropped the
	// positional overload: a raw Database passed positionally is read as a
	// *config* object, finds no client in it, and quietly opens a second, empty
	// database — so every query answers "no such table" against tables that
	// demonstrably exist on `sqlite`.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
}
