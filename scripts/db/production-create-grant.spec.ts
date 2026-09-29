/**
 * #1675: Booking opens its own shows, through an org-wide `production.create`. The
 * migration grants it to Booking alone, audits the change, tolerates a database with
 * no Booking committee, and changes nothing when run a second time.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_production_create_grant'));
const GRANT = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runGrant(db: DatabaseSync) {
	for (const statement of GRANT.split('--> statement-breakpoint')) db.exec(statement);
}

function migrated(): DatabaseSync {
	const file = join(mkdtempSync(join(tmpdir(), 'corvmc-production-create-')), 'd1.sqlite');
	applyMigrations(file);
	return new DatabaseSync(file);
}

const grantsOf = (db: DatabaseSync, id: string) =>
	(
		db
			.prepare(
				`SELECT capability AS c FROM group_capability WHERE group_id = ? ORDER BY capability`
			)
			.all(id) as Array<{ c: string }>
	).map((r) => r.c);

const audits = (db: DatabaseSync) =>
	db
		.prepare(`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log`)
		.all() as Array<{ id: string; a: string; d: string }>;

describe('production.create grant', () => {
	it('gives Booking production.create beside what it had, and nobody else', () => {
		const db = migrated();
		db.exec(`
			INSERT INTO "group" (id, name, slug, kind) VALUES
				('book', 'Booking Committee', 'booking-committee', 'committee'),
				('prod', 'Production Committee', 'production-committee', 'committee'),
				('band', 'Booking Committee', 'a-band-named-that', 'band');
			INSERT INTO group_capability (group_id, capability) VALUES
				('book', 'production.book'),
				('prod', 'production.run');
		`);
		runGrant(db);
		expect(grantsOf(db, 'book')).toEqual(['production.book', 'production.create']);
		expect(grantsOf(db, 'prod')).toEqual(['production.run']);
		expect(grantsOf(db, 'band')).toEqual([]);

		const rows = audits(db);
		expect(rows.map((r) => r.id)).toEqual(['book']);
		expect(rows[0].a).toBe('System');
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['production.create'], removed: [] });

		runGrant(db);
		expect(grantsOf(db, 'book')).toEqual(['production.book', 'production.create']);
		expect(audits(db)).toHaveLength(1);
	});

	it('does nothing on a database with no Booking committee', () => {
		const db = migrated();
		db.exec(`INSERT INTO "group" (id, name, slug, kind) VALUES
			('fac', 'Facility Committee', 'facility-committee', 'committee');`);
		runGrant(db);
		expect(grantsOf(db, 'fac')).toEqual([]);
		expect(audits(db)).toEqual([]);
	});
});
