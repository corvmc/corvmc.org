import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { bandSite } from '../../../src/lib/server/db/schema/band-site';

const SQL = readFileSync('scripts/db/backfill/band-site.sql', 'utf8');
/** Comments first: the header prose contains semicolons of its own. */
const CODE = SQL.replace(/^\s*--.*$/gm, '');

/** DDL from the generated migration, so this tracks the schema rather than a copy of it. */
function migrationDdl(): string[] {
	const file = globSync('migrations/*/migration.sql')
		.sort()
		.find((f) => readFileSync(f, 'utf8').includes('CREATE TABLE `band_site`'));
	if (!file) throw new Error('no migration creates band_site');
	return readFileSync(file, 'utf8')
		.split('--> statement-breakpoint')
		.map((c) => c.trim())
		.filter(Boolean);
}

/** Only what the backfill reads. Hand-written: this is the table being drained. */
const SOURCE_DDL = [
	`CREATE TABLE "group" (
		id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'band',
		tier text NOT NULL DEFAULT 'free', subscription text,
		custom_domain text, custom_domain_status text, custom_domain_hostname_id text,
		custom_domain_verification text, custom_domain_added_at integer,
		created_at integer NOT NULL DEFAULT (unixepoch()),
		updated_at integer NOT NULL DEFAULT (unixepoch())
	)`,
	`CREATE TABLE band_page_config (id text PRIMARY KEY, band_id text NOT NULL, band_site_id text)`,
	// `type` and `sort_order` are here only because the migration's
	// `idx_band_media_site_type` indexes them; the backfill itself reads neither.
	`CREATE TABLE band_media (
		id text PRIMARY KEY, band_id text NOT NULL, band_site_id text,
		type text NOT NULL DEFAULT 'image', sort_order integer NOT NULL DEFAULT 0
	)`
];

function seeded() {
	const db = new Database(':memory:');
	db.exec('PRAGMA foreign_keys = OFF');
	for (const stmt of [...SOURCE_DDL, ...migrationDdl().filter((s) => !s.startsWith('ALTER'))])
		db.exec(stmt);

	db.exec(`
		INSERT INTO "group" (id, name, kind, tier, custom_domain, custom_domain_status) VALUES
			('g1','Premium Band','band','premium','loud.example','active'),
			('g2','Free Band','band','free',NULL,NULL),
			('g3','Real Book Club','club','free',NULL,NULL);
		INSERT INTO band_page_config (id, band_id) VALUES ('pc1','g1');
		INSERT INTO band_media (id, band_id) VALUES ('m1','g1'), ('m2','g1');
	`);
	return db;
}

const run = (db: Database.Database) => db.exec(SQL);
const one = <T>(db: Database.Database, sql: string): T => db.prepare(sql).get() as T;

describe('band-site backfill: shape', () => {
	it('guards every UPDATE so a re-run cannot move an already re-keyed row', () => {
		// This file needs UPDATEs — unlike the directory backfill — because the
		// re-key is an update by nature. `WHERE band_site_id IS NULL` is what keeps
		// it re-runnable: without it, a second run would rewrite rows the
		// application may have since repointed.
		const updates = CODE.split(';')
			.map((s) => s.trim())
			.filter((s) => s.toUpperCase().startsWith('UPDATE'));

		expect(updates).toHaveLength(2);
		for (const statement of updates) {
			expect(statement).toMatch(/WHERE\s+band_site_id\s+IS\s+NULL/i);
		}
	});

	it('names only real band_site columns', () => {
		const known = Object.values(getTableColumns(bandSite)).map((c) => c.name);
		for (const [, list] of CODE.matchAll(/INSERT INTO band_site \(([^)]*)\)/g)) {
			for (const column of list.split(',').map((c) => c.trim())) {
				expect(known).toContain(column);
			}
		}
	});
});

describe('band-site backfill: against sqlite', () => {
	let db: Database.Database;
	beforeAll(() => {
		db = seeded();
		run(db);
	});

	it('gives every band a site and no club one', () => {
		// A club or committee cannot buy a microsite, so it gets no row. Every
		// group is a band today; the predicate is here so a re-run after phase 5
		// does not hand a committee a site record.
		const rows = db.prepare('SELECT group_id FROM band_site ORDER BY group_id').all() as {
			group_id: string;
		}[];
		expect(rows.map((r) => r.group_id)).toEqual(['g1', 'g2']);
	});

	it('gives a FREE band a row too', () => {
		// The row is what `tier` lives on, and deleting it on a cancelled
		// subscription would cascade the band's page config and media away.
		expect(one<{ tier: string }>(db, "SELECT tier FROM band_site WHERE group_id = 'g2'").tier).toBe(
			'free'
		);
	});

	it('carries the premium columns across', () => {
		const row = one<{ tier: string; custom_domain: string; custom_domain_status: string }>(
			db,
			"SELECT tier, custom_domain, custom_domain_status FROM band_site WHERE group_id = 'g1'"
		);
		expect(row).toEqual({
			tier: 'premium',
			custom_domain: 'loud.example',
			custom_domain_status: 'active'
		});
	});

	it('never reuses the group id', () => {
		expect(one<{ n: number }>(db, 'SELECT count(*) n FROM band_site WHERE id = group_id').n).toBe(
			0
		);
	});

	it('mints a distinct id per row', () => {
		const { total, distinct_ids } = one<{ total: number; distinct_ids: number }>(
			db,
			'SELECT count(*) total, count(DISTINCT id) distinct_ids FROM band_site'
		);
		expect(distinct_ids).toBe(total);
	});

	it('re-keys the page config and the media to the site', () => {
		const siteId = one<{ id: string }>(db, "SELECT id FROM band_site WHERE group_id = 'g1'").id;
		expect(
			one<{ id: string }>(db, "SELECT band_site_id AS id FROM band_page_config WHERE id = 'pc1'").id
		).toBe(siteId);
		expect(
			one<{ n: number }>(db, `SELECT count(*) n FROM band_media WHERE band_site_id = '${siteId}'`).n
		).toBe(2);
	});

	it('changes nothing on a second run', () => {
		const before = db.prepare('SELECT * FROM band_site ORDER BY id').all();
		const configBefore = db.prepare('SELECT * FROM band_page_config ORDER BY id').all();

		run(db);

		expect(db.prepare('SELECT * FROM band_site ORDER BY id').all()).toEqual(before);
		expect(db.prepare('SELECT * FROM band_page_config ORDER BY id').all()).toEqual(configBefore);
	});

	it('picks up a band added after the first run', () => {
		const fresh = seeded();
		run(fresh);
		fresh.exec(`INSERT INTO "group" (id, name, kind) VALUES ('g4','Later Band','band')`);
		run(fresh);

		expect(one<{ n: number }>(fresh, 'SELECT count(*) n FROM band_site').n).toBe(3);
	});
});
