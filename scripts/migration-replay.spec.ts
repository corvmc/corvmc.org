import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Replays the committed migrations and holds the result to the drizzle snapshot.
 *
 * The `schema-drift` CI job already runs `drizzle-kit generate` and fails if it produces
 * anything — but that diffs the *schema files* against the *snapshot*, and both sides can
 * be wrong together. `product_config` is how: its schema file was deleted when the product
 * catalogue moved to KV, the snapshot stopped declaring the table, and no migration ever
 * emitted the `DROP`. Schema and snapshot agreed perfectly. The table sat in production for
 * three months, and `db:generate` could not have proposed the drop, because the snapshot it
 * diffs against had already forgotten the table existed.
 *
 * This is the third side of that triangle: what the migrations actually build. It is the only
 * check that reads the SQL, so it is the only one that can see a table nothing declares.
 */

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/** Migration directories, oldest first — `<timestamp>_<name>` sorts chronologically. */
function migrationDirs(): string[] {
	return readdirSync(MIGRATIONS)
		.filter((n) => /^\d{14}_/.test(n))
		.sort();
}

/**
 * Tables a fresh database ends up with after every migration has run.
 *
 * Statement-level rather than file-level: drizzle's table rebuilds create `__new_x`, copy,
 * `DROP TABLE x` and rename over it, so a file-wide regex would read the rebuild's DROP as a
 * deletion. Walking one statement at a time in order gets the rename right.
 */
function replayTables(): Set<string> {
	const live = new Set<string>();
	for (const dir of migrationDirs()) {
		const sql = readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), 'utf8');
		for (const statement of sql.split('--> statement-breakpoint')) {
			const created = /CREATE TABLE (?:IF NOT EXISTS )?`([A-Za-z0-9_]+)`/i.exec(statement);
			if (created) live.add(created[1]);
			const dropped = /DROP TABLE\s+(?:IF EXISTS\s+)?`([A-Za-z0-9_]+)`/i.exec(statement);
			if (dropped) live.delete(dropped[1]);
			const renamed = /ALTER TABLE `([A-Za-z0-9_]+)` RENAME TO `([A-Za-z0-9_]+)`/i.exec(statement);
			if (renamed) {
				live.delete(renamed[1]);
				live.add(renamed[2]);
			}
		}
	}
	// Scratch tables from a rebuild or from `d1-safe-rebuild`'s detach/reattach never survive
	// their own migration; if one does, that is a different bug and the assertion will say so.
	return live;
}

function snapshotTables(): Set<string> {
	const dirs = migrationDirs();
	const latest = dirs[dirs.length - 1];
	const snapshot = JSON.parse(readFileSync(new URL(`${latest}/snapshot.json`, MIGRATIONS), 'utf8'));
	return new Set<string>(
		snapshot.ddl
			.filter((e: { entityType: string }) => e.entityType === 'tables')
			.map((e: { name: string }) => e.name)
	);
}

describe('migration replay', () => {
	const replayed = replayTables();
	const declared = snapshotTables();

	it('builds every table the schema declares', () => {
		expect([...declared].filter((t) => !replayed.has(t)).sort()).toEqual([]);
	});

	it('leaves behind no table the schema does not declare', () => {
		// A table here exists in every database and in no schema file: nothing reads it, nothing
		// can drop it through `db:generate`, and it will outlive everyone who remembers why.
		// The fix is a `drizzle-kit generate --custom` migration carrying the DROP.
		expect([...replayed].filter((t) => !declared.has(t)).sort()).toEqual([]);
	});
});
