/**
 * #1673 moves the production console onto production.book and production.run. The
 * backfill gives Booking the first and Production the second, so moving the guards
 * strips nobody, and fills any `project_committee` rows written in between. Runs it
 * on a migrated scratch file, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) =>
	n.endsWith('_production_capability_backfill')
);
const BACKFILL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runBackfill(db: DatabaseSync) {
	for (const statement of BACKFILL.split('--> statement-breakpoint')) db.exec(statement);
}

const grantsOf = (db: DatabaseSync, id: string) =>
	(
		db
			.prepare(
				`SELECT capability AS c FROM group_capability WHERE group_id = ? ORDER BY capability`
			)
			.all(id) as Array<{ c: string }>
	).map((r) => r.c);

const committeesOn = (db: DatabaseSync, projectId: string) =>
	db
		.prepare(
			`SELECT group_id AS g, role AS r FROM project_committee WHERE project_id = ? ORDER BY group_id`
		)
		.all(projectId);

const auditCount = (db: DatabaseSync) =>
	(db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('production capability backfill', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-production-caps-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`
			INSERT INTO "group" (id, name, slug, kind) VALUES
				('book', 'Booking Committee', 'booking-committee', 'committee'),
				('prod', 'Production Committee', 'production-committee', 'committee'),
				('fac', 'Facility Committee', 'facility-committee', 'committee'),
				('band', 'Booking Committee', 'a-band-named-that', 'band');
			INSERT INTO group_capability (group_id, capability) VALUES
				('book', 'event.publish'),
				('prod', 'production.run');
			INSERT INTO project (id, name, kind, group_id) VALUES
				('show', 'Friday', 'production', NULL),
				('paint', 'Repaint', 'general', 'fac');
		`);
		runBackfill(db);
	});

	it('gives Booking production.book beside what it had', () => {
		expect(grantsOf(db, 'book')).toEqual(['event.publish', 'production.book']);
	});

	it('gives Production production.run, which it already held here', () => {
		expect(grantsOf(db, 'prod')).toEqual(['production.run']);
	});

	it('leaves other committees and a band that shares the name alone', () => {
		expect(grantsOf(db, 'fac')).toEqual([]);
		expect(grantsOf(db, 'band')).toEqual([]);
	});

	it('audits only the committee it changed, by System', () => {
		const rows = db
			.prepare(`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log`)
			.all() as Array<{ id: string; a: string; d: string }>;
		expect(rows.map((r) => r.id)).toEqual(['book']);
		expect(rows[0].a).toBe('System');
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['production.book'], removed: [] });
	});

	it('fills project committees written between the schema and this', () => {
		expect(committeesOn(db, 'show')).toEqual([
			{ g: 'book', r: 'booking' },
			{ g: 'prod', r: 'production' }
		]);
		expect(committeesOn(db, 'paint')).toEqual([{ g: 'fac', r: 'owner' }]);
	});

	it('changes nothing when run a second time', () => {
		const ids = ['book', 'prod', 'fac', 'band'];
		const before = ids.map((id) => grantsOf(db, id));
		const audits = auditCount(db);
		runBackfill(db);
		expect(ids.map((id) => grantsOf(db, id))).toEqual(before);
		expect(auditCount(db)).toBe(audits);
		expect(committeesOn(db, 'show')).toHaveLength(2);
	});
});
