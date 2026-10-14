/**
 * One migration that both adds columns to a child and rebuilds that child's parent (#1899).
 *
 * The detach blocks run before drizzle's statements, so they have to describe each child as it
 * is *before* the migration, while the reattach blocks describe it after. Every case is replayed
 * against real SQLite with foreign keys on, inside a transaction as D1 runs a migration.
 */
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { replayDatabase, rewriteMigration } from './d1-safe-rebuild.mjs';
import { columnList, readSnapshot, renderCreateTable } from './d1-ddl.mjs';
import type { Snapshot, SnapshotEntity } from './snapshot-types';

const BREAK = '\n--> statement-breakpoint\n';
const TABLES = ['parent', 'child', 'job', 'grandjob', 'dual'];

const col = (table: string, name: string, notNull = false): SnapshotEntity => ({
	entityType: 'columns',
	table,
	name,
	type: 'text',
	notNull,
	default: null
});
const pk = (table: string): SnapshotEntity => ({
	entityType: 'pks',
	table,
	name: `${table}_pk`,
	columns: ['id']
});
const fk = (table: string, column: string, tableTo: string, onDelete: string): SnapshotEntity => ({
	entityType: 'fks',
	table,
	name: `fk_${table}_${column}`,
	columns: [column],
	tableTo,
	columnsTo: ['id'],
	onDelete,
	onUpdate: 'NO ACTION'
});

/** Before: `child` and `dual` cascade to parent; `job` does not reference it; `grandjob` → `job`. */
const before: SnapshotEntity[] = [
	...TABLES.map((name): SnapshotEntity => ({ entityType: 'tables', name })),
	col('parent', 'id', true),
	pk('parent'),
	col('child', 'id', true),
	col('child', 'parent_id'),
	pk('child'),
	fk('child', 'parent_id', 'parent', 'CASCADE'),
	col('job', 'id', true),
	col('job', 'title'),
	pk('job'),
	col('grandjob', 'id', true),
	col('grandjob', 'job_id', true),
	pk('grandjob'),
	fk('grandjob', 'job_id', 'job', 'CASCADE'),
	col('dual', 'id', true),
	col('dual', 'parent_id'),
	pk('dual'),
	fk('dual', 'parent_id', 'parent', 'CASCADE')
];

/**
 * After: `job` and `dual` each gain a RESTRICT FK column to parent, `job`'s indexed; `child`
 * gains a plain column.
 */
const after: Snapshot = {
	ddl: [
		...before,
		col('job', 'parent_id'),
		fk('job', 'parent_id', 'parent', 'RESTRICT'),
		{
			entityType: 'indexes',
			table: 'job',
			name: 'idx_job_parent',
			columns: [{ value: 'parent_id', isExpression: false }],
			isUnique: false,
			where: null
		},
		col('dual', 'other_parent_id'),
		fk('dual', 'other_parent_id', 'parent', 'RESTRICT'),
		col('child', 'note')
	]
};

const adds = [
	'ALTER TABLE `job` ADD `parent_id` text REFERENCES parent(id) ON DELETE RESTRICT;',
	'ALTER TABLE `dual` ADD `other_parent_id` text REFERENCES parent(id) ON DELETE RESTRICT;',
	'ALTER TABLE `child` ADD `note` text;'
];
const index = 'CREATE INDEX `idx_job_parent` ON `job` (`parent_id`);';

/** drizzle's rebuild of `parent`, columns unchanged. */
function parentRebuild(): string[] {
	const snap = readSnapshot(after);
	const cols = columnList(snap, 'parent');
	return [
		'PRAGMA foreign_keys=OFF;',
		renderCreateTable(snap, 'parent', { as: '__new_parent' }),
		`INSERT INTO \`__new_parent\`(${cols}) SELECT ${cols} FROM \`parent\`;`,
		'DROP TABLE `parent`;',
		'ALTER TABLE `__new_parent` RENAME TO `parent`;',
		'PRAGMA foreign_keys=ON;'
	];
}

/** The database the earlier migrations left behind, with a row in every table. */
function seeded(): DatabaseSync {
	const db = replayDatabase();
	const snap = readSnapshot({ ddl: before });
	for (const t of snap.tables) db.exec(renderCreateTable(snap, t));
	db.exec(`
		INSERT INTO parent VALUES ('p1');
		INSERT INTO child VALUES ('c1', 'p1');
		INSERT INTO job VALUES ('j1', 'fix the door');
		INSERT INTO grandjob VALUES ('g1', 'j1');
		INSERT INTO dual VALUES ('d1', 'p1');
	`);
	return db;
}

/** Apply `sql` as D1 would and commit, which is where a deferred FK violation surfaces. */
function apply(sql: string, db = seeded()): DatabaseSync {
	db.exec(sql);
	db.exec('COMMIT');
	return db;
}

const count = (db: DatabaseSync, t: string) =>
	(db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;

function fkActions(db: DatabaseSync, table: string): Record<string, string> {
	const rows = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
		from: string;
		on_delete: string;
	}[];
	return Object.fromEntries(rows.map((r) => [r.from, r.on_delete]));
}

describe.each([
	['before the rebuild', [...adds, ...parentRebuild(), index]],
	['after the rebuild', [...parentRebuild(), ...adds, index]]
])('the added columns come %s', (_, statements) => {
	const rewrite = () => rewriteMigration(statements.join(BREAK), after) as string;

	it('applies, keeping every row in every table', () => {
		const db = apply(rewrite());
		for (const t of TABLES) expect(count(db, t), t).toBe(1);
		expect(db.prepare('SELECT parent_id FROM child').get()).toEqual({ parent_id: 'p1' });
		expect(db.prepare('SELECT parent_id FROM dual').get()).toEqual({ parent_id: 'p1' });
	});

	it('does not detach a child whose only FK to the parent is the new column', () => {
		expect(rewrite()).not.toContain('__detach_job');
		expect(rewrite()).not.toContain('__detach_grandjob');
	});

	it('still detaches each child that already referenced the parent', () => {
		expect(rewrite()).toContain('-- detach dual');
		expect(rewrite()).toContain('-- detach child');
	});

	it('detaches without the columns the migration has not added yet', () => {
		const out = rewrite();
		const block = (t: string) =>
			out.slice(out.indexOf(`-- detach ${t}`), out.indexOf(`ALTER TABLE \`__detach_${t}\``));
		expect(block('dual')).toContain('`parent_id`');
		expect(block('dual')).not.toContain('other_parent_id');
		expect(block('child')).toContain('`parent_id`');
		expect(block('child')).not.toContain('`note`');
	});

	it('ends with every FK on each child and its real action', () => {
		const db = apply(rewrite());
		expect(fkActions(db, 'dual')).toEqual({ parent_id: 'CASCADE', other_parent_id: 'RESTRICT' });
		expect(fkActions(db, 'job')).toEqual({ parent_id: 'RESTRICT' });
		expect(fkActions(db, 'child')).toEqual({ parent_id: 'CASCADE' });
	});

	it('keeps the index the migration creates', () => {
		const db = apply(rewrite());
		const idx = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_job_parent'")
			.all();
		expect(idx).toHaveLength(1);
	});
});

describe('an index the migration drops from a detached child', () => {
	it('is gone afterwards, and the migration applies', () => {
		const db = seeded();
		db.exec('CREATE INDEX idx_child_parent ON child (parent_id)');
		const sql = ['DROP INDEX `idx_child_parent`;', ...parentRebuild()].join(BREAK);
		const out = rewriteMigration(sql, { ddl: before }) as string;
		expect(out).toContain('-- detach child');
		apply(out, db);
		expect(
			db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_child_parent'").all()
		).toEqual([]);
		for (const t of TABLES) expect(count(db, t), t).toBe(1);
	});
});

describe('a detached child the migration alters in a way the detach cannot model', () => {
	it.each([
		'ALTER TABLE `dual` RENAME COLUMN `parent_id` TO `owner_id`;',
		'ALTER TABLE `child` DROP COLUMN `parent_id`;'
	])('refuses %s with a message to split the migration', (alter) => {
		const sql = [alter, ...parentRebuild()].join(BREAK);
		expect(() => rewriteMigration(sql, after)).toThrow(/split/i);
	});
});

describe('a rebuild whose children already have the new columns', () => {
	it('detaches and restores every child, as before', () => {
		const db = seeded();
		for (const a of adds) db.exec(a);
		db.exec(index);
		const out = rewriteMigration(parentRebuild().join(BREAK), after) as string;
		expect(out).toContain('-- detach job');
		expect(out).toContain('-- detach grandjob');
		apply(out, db);
		for (const t of TABLES) expect(count(db, t), t).toBe(1);
		expect(fkActions(db, 'dual')).toEqual({ parent_id: 'CASCADE', other_parent_id: 'RESTRICT' });
	});
});
