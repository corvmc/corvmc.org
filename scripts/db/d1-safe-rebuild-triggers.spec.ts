/**
 * A table rebuild keeps the triggers on every table it drops (#1746).
 *
 * SQLite drops a table's triggers with the table. drizzle's snapshot does not model
 * triggers, so neither drizzle's rebuild nor the detach/reattach around it re-creates
 * them, and no other check notices: `production.project_id` stops being required.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
	findLostTriggers,
	replay,
	replayDatabase,
	restoreTriggers,
	rewriteMigration
} from './d1-safe-rebuild.mjs';
import { columnList, readSnapshot, renderCreateTable, renderIndexes } from './d1-ddl.mjs';
import type { Snapshot } from './snapshot-types';

const BREAK = '\n--> statement-breakpoint\n';
const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');

function triggerNames(db: DatabaseSync): string[] {
	return (
		db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as {
			name: string;
		}[]
	).map((r) => r.name);
}

/** What `--write` does to one migration, in the order `main()` does it. */
function fix(db: DatabaseSync, sql: string, snapshot: Snapshot): string {
	const rewritten = rewriteMigration(sql, snapshot) ?? sql;
	return restoreTriggers(rewritten, findLostTriggers(db, rewritten));
}

/** A rebuild in the shape drizzle-kit emits one, columns unchanged. */
function drizzleRebuild(snapshot: Snapshot, table: string): string {
	const snap = readSnapshot(snapshot);
	const cols = columnList(snap, table);
	return [
		'PRAGMA foreign_keys=OFF;',
		renderCreateTable(snap, table, { as: `__new_${table}` }),
		`INSERT INTO \`__new_${table}\`(${cols}) SELECT ${cols} FROM \`${table}\`;`,
		`DROP TABLE \`${table}\`;`,
		`ALTER TABLE \`__new_${table}\` RENAME TO \`${table}\`;`,
		...renderIndexes(snap, table),
		'PRAGMA foreign_keys=ON;'
	].join(BREAK);
}

describe('a rebuild of a table with a trigger', () => {
	let db: DatabaseSync;
	const rebuild = [
		'CREATE TABLE `__new_note` (`id` text PRIMARY KEY NOT NULL, `body` text);',
		'INSERT INTO `__new_note`(`id`, `body`) SELECT `id`, `body` FROM `note`;',
		'DROP TABLE `note`;',
		'ALTER TABLE `__new_note` RENAME TO `note`;'
	].join(BREAK);

	beforeAll(() => {
		db = replayDatabase();
		db.exec(`
			CREATE TABLE note (id text PRIMARY KEY NOT NULL, body text);
			CREATE TRIGGER note_body_required BEFORE INSERT ON note
			WHEN NEW.body IS NULL BEGIN SELECT RAISE(ABORT, 'body is required'); END;
		`);
	});

	it('loses the trigger as drizzle writes it', () => {
		expect(findLostTriggers(db, rebuild).map((t) => t.name)).toEqual(['note_body_required']);
	});

	it('keeps the trigger once restored, and it still fires', () => {
		const fixed = restoreTriggers(rebuild, findLostTriggers(db, rebuild));
		db.exec('SAVEPOINT t');
		try {
			db.exec(fixed);
			expect(triggerNames(db)).toEqual(['note_body_required']);
			expect(() => db.exec("INSERT INTO note (id) VALUES ('n1')")).toThrow('body is required');
		} finally {
			db.exec('ROLLBACK TO t');
		}
	});

	it('is idempotent: a restored migration loses nothing', () => {
		const fixed = restoreTriggers(rebuild, findLostTriggers(db, rebuild));
		expect(findLostTriggers(db, fixed)).toEqual([]);
	});

	it('does not restore a trigger the migration drops by name', () => {
		expect(findLostTriggers(db, `DROP TRIGGER \`note_body_required\`;${BREAK}${rebuild}`)).toEqual(
			[]
		);
	});

	it('does not restore a trigger whose table is dropped for good', () => {
		expect(findLostTriggers(db, 'DROP TABLE `note`;')).toEqual([]);
	});

	it('leaves the database as it found it', () => {
		findLostTriggers(db, rebuild);
		expect(triggerNames(db)).toEqual(['note_body_required']);
	});
});

describe('the committed migrations', () => {
	const dirs = readdirSync(MIGRATIONS)
		.filter((d) => existsSync(join(MIGRATIONS, d, 'migration.sql')))
		.sort();
	const latestSnapshot = [...dirs]
		.reverse()
		.find((d) => existsSync(join(MIGRATIONS, d, 'snapshot.json')));
	let db: DatabaseSync;
	/** Triggers each migration dropped without asking to, by migration. */
	const lost: Record<string, string[]> = {};

	beforeAll(() => {
		db = replayDatabase();
		for (const dir of dirs) {
			const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
			const names = findLostTriggers(db, sql).map((t) => t.name);
			if (names.length) lost[dir] = names;
			replay(db, dir, sql);
		}
	});

	it('never dropped a trigger without dropping it by name', () => {
		expect(lost).toEqual({});
	});

	it('leave the production.project_id triggers in place', () => {
		expect(triggerNames(db)).toEqual(
			expect.arrayContaining([
				'production_project_required_insert',
				'production_project_required_update'
			])
		);
	});

	// `project` is the parent of `production`, so its rebuild detaches `production`.
	it('keep every trigger through a rebuild of `project`', () => {
		const snapshot = JSON.parse(
			readFileSync(join(MIGRATIONS, latestSnapshot as string, 'snapshot.json'), 'utf8')
		) as Snapshot;
		const before = triggerNames(db);
		db.exec('SAVEPOINT rebuild');
		try {
			db.exec(fix(db, drizzleRebuild(snapshot, 'project'), snapshot));
			expect(triggerNames(db)).toEqual(before);
		} finally {
			db.exec('ROLLBACK TO rebuild');
		}
	});
});
