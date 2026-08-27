/**
 * Holds `db:migrate:local` to the two properties the old shell loop gave for
 * free, and one it did not.
 *
 * The loop replayed every migration file through `wrangler d1 execute`, so "the
 * local schema is the committed migrations" was true by construction. Going
 * through drizzle's migrator instead buys 60s a run but moves that guarantee
 * into a library, which is what this pins:
 *
 *   - every migration directory is applied, exactly once
 *   - a second run is a no-op rather than a replay (the new behaviour — the
 *     loop errored on an already-migrated database)
 *   - the tables it leaves behind are the ones `scripts/d1-table-order.mjs`
 *     names, so a migration cannot add a table that `e2e/reset-db.ts` will then
 *     silently decline to clear
 *
 * Runs against a scratch file, not a miniflare state directory: `applyMigrations`
 * is deliberately the half of the script with no workerd in it.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from './migrate-local';
// @ts-expect-error -- plain .mjs helper, no types
import { tableOrder } from '../d1-table-order.mjs';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

/** The migration directories, the way drizzle's `readMigrationFiles` counts them. */
function migrationNames(): string[] {
	return readdirSync(MIGRATIONS_DIR)
		.filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
		.sort();
}

function query<T>(file: string, sql: string): T[] {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return db.prepare(sql).all() as T[];
	} finally {
		db.close();
	}
}

describe('applyMigrations', () => {
	let file: string;

	beforeAll(() => {
		file = join(mkdtempSync(join(tmpdir(), 'corvmc-migrate-')), 'd1.sqlite');
		applyMigrations(file);
	});

	it('applies every migration directory, in filename order', () => {
		const applied = query<{ name: string }>(
			file,
			'SELECT name FROM __drizzle_migrations ORDER BY id'
		).map((row) => row.name);

		expect(applied).toEqual(migrationNames());
	});

	it('is a no-op the second time', () => {
		const before = query<{ c: number }>(file, 'SELECT count(*) AS c FROM __drizzle_migrations');

		// The loop this replaced could only ever run against an empty database —
		// a second pass hit `CREATE TABLE` on a table that already existed. This
		// is the behaviour change that lets `e2e/prepare.ts` migrate every run
		// instead of rebuilding the whole state directory when a migration lands.
		expect(() => applyMigrations(file)).not.toThrow();

		expect(query<{ c: number }>(file, 'SELECT count(*) AS c FROM __drizzle_migrations')).toEqual(
			before
		);
	});

	it('leaves exactly the tables d1-table-order.mjs knows how to clear', () => {
		const tables = query<{ name: string }>(
			file,
			`SELECT name FROM sqlite_master
			 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'`
		).map((row) => row.name);

		expect([...tables].sort()).toEqual([...(tableOrder as string[])].sort());
	});
});
