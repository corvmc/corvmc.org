import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { directoryEntry, directoryTag } from '../../../src/lib/server/db/schema/directory';

const SQL = readFileSync('scripts/db/backfill/directory-entry.sql', 'utf8');
/** Comments go first, and only then does splitting on `;` mean anything — the
 * header prose contains semicolons of its own. */
const CODE = SQL.replace(/^\s*--.*$/gm, '');

/**
 * The DDL comes out of the generated migration rather than being hand-copied,
 * so this spec tracks the schema instead of a duplicate of it. If a later phase
 * changes a column, the assertions below fail rather than testing a fossil.
 */
function migrationDdl(): string[] {
	const file = globSync('migrations/*/migration.sql')
		.sort()
		.find((f) => readFileSync(f, 'utf8').includes('CREATE TABLE `directory_entry`'));
	if (!file) throw new Error('no migration creates directory_entry');
	return readFileSync(file, 'utf8')
		.split('--> statement-breakpoint')
		.map((chunk) => chunk.trim())
		.filter(Boolean);
}

/**
 * Only the columns the backfill reads. Hand-written on purpose: these are the
 * tables being drained, and pinning them to today's full schema would make this
 * spec fail for changes that have nothing to do with the fold.
 */
const SOURCE_DDL = [
	`CREATE TABLE "user" (
		id text PRIMARY KEY,
		name text NOT NULL,
		bio text, tagline text, hometown text, links text,
		directory_visibility text NOT NULL DEFAULT 'members',
		directory_contact text,
		looking_for_band integer NOT NULL DEFAULT 0,
		available_for_hire integer NOT NULL DEFAULT 0,
		teaches_lessons integer NOT NULL DEFAULT 0,
		open_to_collaboration integer NOT NULL DEFAULT 0,
		created_at integer NOT NULL DEFAULT (unixepoch()),
		updated_at integer NOT NULL DEFAULT (unixepoch()),
		deleted_at integer
	)`,
	`CREATE TABLE "group" (
		id text PRIMARY KEY,
		name text NOT NULL,
		bio text, tagline text, hometown text, founded_year text, avatar_key text, links text,
		directory_visibility text NOT NULL DEFAULT 'public',
		directory_contact text,
		looking_for_members integer NOT NULL DEFAULT 0,
		created_at integer NOT NULL DEFAULT (unixepoch()),
		updated_at integer NOT NULL DEFAULT (unixepoch()),
		deleted_at integer
	)`,
	`CREATE TABLE band_genre (band_id text NOT NULL, genre text NOT NULL)`,
	`CREATE TABLE user_genre (user_id text NOT NULL, genre text NOT NULL)`,
	`CREATE TABLE user_instrument (user_id text NOT NULL, instrument text NOT NULL)`
];

function seeded() {
	const db = new Database(':memory:');
	for (const stmt of [...SOURCE_DDL, ...migrationDdl()]) db.exec(stmt);

	db.exec(`
		INSERT INTO "user" (id, name, bio, tagline, hometown, directory_visibility, looking_for_band, teaches_lessons, deleted_at) VALUES
			('u1', 'Ada',  'plays out',  'bassist', 'Corvallis', 'public',  1, 1, NULL),
			('u2', 'Bo',   NULL,         NULL,      NULL,        'hidden',  0, 0, NULL),
			('u3', 'Cyd',  NULL,         NULL,      NULL,        'members', 0, 0, 1700000000);
		INSERT INTO "group" (id, name, bio, founded_year, avatar_key, directory_visibility, looking_for_members, deleted_at) VALUES
			('g1', 'The Regulars', 'a band', '2019', 'bands/avatars/g1.jpg', 'public', 1, NULL),
			('g2', 'Wound Up',     NULL,     NULL,   NULL,                  'public', 0, 1700000000);
		INSERT INTO band_genre (band_id, genre) VALUES ('g1','jazz'), ('g1','jazz'), ('g1','Jazz'), ('g2','folk');
		INSERT INTO user_genre (user_id, genre) VALUES ('u1','jazz'), ('u1','jazz');
		INSERT INTO user_instrument (user_id, instrument) VALUES ('u1','bass'), ('u1','drums');
	`);
	return db;
}

const run = (db: Database.Database) => db.exec(SQL);
const one = <T>(db: Database.Database, sql: string): T => db.prepare(sql).get() as T;

describe('directory-entry backfill: shape', () => {
	it('has no UPDATE anywhere', () => {
		// The invariant the whole file rests on. Every statement is an insert, so
		// it is safe to re-run forever — including after the port deploys, to
		// sweep up rows created in the window. An UPDATE here would quietly take
		// that away, and nothing else would notice.
		expect(CODE).not.toMatch(/\bUPDATE\b/i);
	});

	it('gives every INSERT a WHERE or an ON CONFLICT', () => {
		// SQLite cannot parse `INSERT … SELECT … ON CONFLICT` without a WHERE on
		// the SELECT, and an insert with neither is not idempotent.
		const statements = CODE.split(';')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(statements).toHaveLength(5);
		for (const statement of statements) {
			expect(statement).toMatch(/\bWHERE\b|\bON CONFLICT\b/i);
		}
	});

	it.each([
		['directory_entry', directoryEntry],
		['directory_tag', directoryTag]
	])('names only real %s columns', (table, schema) => {
		const known = Object.values(getTableColumns(schema)).map((c) => c.name);
		for (const [, list] of SQL.matchAll(new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)`, 'g'))) {
			for (const column of list.split(',').map((c) => c.trim())) {
				expect(known).toContain(column);
			}
		}
	});
});

describe('directory-entry backfill: against sqlite', () => {
	let db: Database.Database;
	beforeAll(() => {
		db = seeded();
		run(db);
	});

	it('writes one entry per user and per group', () => {
		expect(one<{ n: number }>(db, 'SELECT count(*) n FROM directory_entry').n).toBe(5);
		expect(
			one<{ n: number }>(db, 'SELECT count(*) n FROM directory_entry WHERE user_id IS NOT NULL').n
		).toBe(3);
		expect(
			one<{ n: number }>(db, 'SELECT count(*) n FROM directory_entry WHERE group_id IS NOT NULL').n
		).toBe(2);
	});

	it('mints a distinct id per row', () => {
		// randomblob() is re-evaluated per row inside INSERT … SELECT. Worth
		// proving rather than assuming: one id for every row would collapse the
		// whole table to a single entry.
		const { total, distinct_ids } = one<{ total: number; distinct_ids: number }>(
			db,
			'SELECT count(*) total, count(DISTINCT id) distinct_ids FROM directory_entry'
		);
		expect(distinct_ids).toBe(total);
	});

	it('never reuses the subject id', () => {
		// The spec's central deliberate choice. If entry.id could equal
		// entry.groupId, code passing a group id where an entry id belongs would
		// work on migrated rows and fail only on ones created later.
		expect(
			one<{ n: number }>(
				db,
				'SELECT count(*) n FROM directory_entry WHERE id = group_id OR id = user_id'
			).n
		).toBe(0);
	});

	it('attaches each entry to at most one subject', () => {
		expect(
			one<{ n: number }>(
				db,
				'SELECT count(*) n FROM directory_entry WHERE user_id IS NOT NULL AND group_id IS NOT NULL'
			).n
		).toBe(0);
	});

	it('maps lookingFor in both directions', () => {
		const rows = db
			.prepare(
				`SELECT coalesce(user_id, group_id) subject, looking_for FROM directory_entry ORDER BY subject`
			)
			.all() as { subject: string; looking_for: string | null }[];
		expect(rows).toEqual([
			{ subject: 'g1', looking_for: 'members' },
			{ subject: 'g2', looking_for: null },
			{ subject: 'u1', looking_for: 'band' },
			{ subject: 'u2', looking_for: null },
			{ subject: 'u3', looking_for: null }
		]);
	});

	it('carries deletedAt, so a deactivated subject stays out of the directory', () => {
		const rows = db
			.prepare(
				`SELECT coalesce(user_id, group_id) subject FROM directory_entry WHERE deleted_at IS NOT NULL ORDER BY subject`
			)
			.all() as { subject: string }[];
		expect(rows.map((r) => r.subject)).toEqual(['g2', 'u3']);
	});

	it('carries visibility verbatim', () => {
		// A member who opted out of the directory reappearing is the worst
		// outcome available in this phase.
		const rows = db
			.prepare(`SELECT user_id, visibility FROM directory_entry WHERE user_id IS NOT NULL`)
			.all() as { user_id: string; visibility: string }[];
		expect(Object.fromEntries(rows.map((r) => [r.user_id, r.visibility]))).toEqual({
			u1: 'public',
			u2: 'hidden',
			u3: 'members'
		});
	});

	it('leaves a member entry avatarless and copies a group one', () => {
		expect(
			one<{ n: number }>(
				db,
				'SELECT count(*) n FROM directory_entry WHERE user_id IS NOT NULL AND avatar_key IS NOT NULL'
			).n
		).toBe(0);
		expect(
			one<{ k: string }>(db, "SELECT avatar_key k FROM directory_entry WHERE group_id = 'g1'").k
		).toBe('bands/avatars/g1.jpg');
	});

	it('folds all three tag tables under the right kind, collapsing duplicates', () => {
		const rows = db
			.prepare(
				`SELECT coalesce(e.user_id, e.group_id) subject, t.kind, t.value
				 FROM directory_tag t JOIN directory_entry e ON e.id = t.entry_id
				 ORDER BY subject, kind, value`
			)
			.all();
		// 'jazz' twice on g1 collapses; 'Jazz' does not — SQLite's unique index is
		// case-sensitive and the fold copies values verbatim.
		expect(rows).toEqual([
			{ subject: 'g1', kind: 'genre', value: 'Jazz' },
			{ subject: 'g1', kind: 'genre', value: 'jazz' },
			{ subject: 'g2', kind: 'genre', value: 'folk' },
			{ subject: 'u1', kind: 'genre', value: 'jazz' },
			{ subject: 'u1', kind: 'instrument', value: 'bass' },
			{ subject: 'u1', kind: 'instrument', value: 'drums' }
		]);
	});

	it('leaves no orphan tag', () => {
		expect(
			one<{ n: number }>(
				db,
				'SELECT count(*) n FROM directory_tag t LEFT JOIN directory_entry e ON e.id = t.entry_id WHERE e.id IS NULL'
			).n
		).toBe(0);
	});

	it('changes nothing on a second run', () => {
		// The whole safety property, and the only way to test it. D1 has no
		// transactions, so re-running is what repairs a half-finished run.
		const before = db.prepare('SELECT * FROM directory_entry ORDER BY id').all();
		const tagsBefore = db
			.prepare('SELECT * FROM directory_tag ORDER BY entry_id, kind, value')
			.all();

		run(db);

		expect(db.prepare('SELECT * FROM directory_entry ORDER BY id').all()).toEqual(before);
		expect(db.prepare('SELECT * FROM directory_tag ORDER BY entry_id, kind, value').all()).toEqual(
			tagsBefore
		);
	});

	it('picks up a subject added after the first run', () => {
		const fresh = seeded();
		run(fresh);
		fresh.exec(`INSERT INTO "group" (id, name) VALUES ('g3', 'Real Book Club')`);
		fresh.exec(`INSERT INTO band_genre (band_id, genre) VALUES ('g3', 'jazz')`);
		run(fresh);

		expect(one<{ n: number }>(fresh, 'SELECT count(*) n FROM directory_entry').n).toBe(6);
		expect(
			one<{ n: number }>(
				fresh,
				`SELECT count(*) n FROM directory_tag t JOIN directory_entry e ON e.id = t.entry_id WHERE e.group_id = 'g3'`
			).n
		).toBe(1);
	});
});
