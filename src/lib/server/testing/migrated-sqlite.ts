import { readFileSync, globSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

/**
 * An in-memory SQLite built by replaying every committed migration.
 *
 * A spec that aggregates in SQL needs the real schema: a mocked `db` agrees
 * with a `WHERE` whether or not it is there. Replaying is what
 * `db:migrate:local` does, so it survives the renames, rebuilds and indexes
 * that lifting one table's `CREATE` does not. #847 has the three failures.
 */
export function migratedSqlite(opts: { foreignKeys?: boolean; through?: string } = {}) {
	const sqlite = new Database(':memory:');

	// `through` stops after the migration so named, for a backfill whose columns a later one drops.
	const files = globSync('migrations/*/migration.sql').sort();
	const last = opts.through
		? files.findLastIndex((f) => f.includes(`_${opts.through}/`))
		: files.length - 1;
	if (last < 0) throw new Error(`No migration named *_${opts.through}`);

	for (const file of files.slice(0, last + 1)) {
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
