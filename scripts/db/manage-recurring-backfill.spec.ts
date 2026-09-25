/**
 * #1642 moved recurring work onto `volunteer.manageRecurring`. The backfill gives it
 * to every committee that held `volunteer.manageShifts` and owns recurring work, so
 * none loses the power. Runs it on a migrated scratch file, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) =>
	n.endsWith('_volunteer_manage_recurring_backfill')
);
const BACKFILL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runBackfill(db: DatabaseSync) {
	for (const statement of BACKFILL.split('--> statement-breakpoint')) db.exec(statement);
}

const grantsOf = (db: DatabaseSync, id: string) =>
	(
		JSON.parse(
			(
				db.prepare(`SELECT capability_grants AS g FROM "group" WHERE id = ?`).get(id) as {
					g: string;
				}
			).g
		) as string[]
	).sort();

const auditCount = (db: DatabaseSync) =>
	(db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('volunteer.manageRecurring backfill', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-recurring-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`
			INSERT INTO "group" (id, kind, name, slug, capability_grants) VALUES
				('booking', 'committee', 'Booking', 'booking', '["project.manage","volunteer.manageShifts"]'),
				('retired', 'committee', 'Retired', 'retired', '["volunteer.manageShifts"]'),
				('production', 'committee', 'Production', 'production', '["volunteer.manageShifts"]'),
				('facilities', 'committee', 'Facilities', 'facilities', '["project.manage"]'),
				('band', 'band', 'Some Band', 'some-band', '["volunteer.manageShifts"]');
			INSERT INTO volunteer_role (id, name) VALUES ('clean', 'Cleaning');
			INSERT INTO maintenance_schedule (id, name, volunteer_role_id, group_id, interval_days, retired_at) VALUES
				('ms-booking', 'Weekly holds', 'clean', 'booking', 7, NULL),
				('ms-retired', 'Old walk-through', 'clean', 'retired', 30, 1780000000),
				('ms-facilities', 'Monthly walk-through', 'clean', 'facilities', 30, NULL),
				('ms-band', 'Band gear check', 'clean', 'band', 30, NULL);
		`);
		runBackfill(db);
	});

	it('adds manageRecurring beside manageShifts for a committee that owns recurring work', () => {
		expect(grantsOf(db, 'booking')).toEqual([
			'project.manage',
			'volunteer.manageRecurring',
			'volunteer.manageShifts'
		]);
		expect(grantsOf(db, 'retired')).toEqual([
			'volunteer.manageRecurring',
			'volunteer.manageShifts'
		]);
	});

	it('leaves a committee with no recurring work, one without manageShifts, and a band alone', () => {
		expect(grantsOf(db, 'production')).toEqual(['volunteer.manageShifts']);
		expect(grantsOf(db, 'facilities')).toEqual(['project.manage']);
		expect(grantsOf(db, 'band')).toEqual(['volunteer.manageShifts']);
	});

	it('audits each committee it changed, by System', () => {
		const rows = db
			.prepare(
				`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log ORDER BY subject_id`
			)
			.all() as Array<{ id: string; a: string; d: string }>;
		expect(rows.map((r) => r.id)).toEqual(['booking', 'retired']);
		expect(rows.every((r) => r.a === 'System')).toBe(true);
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['volunteer.manageRecurring'], removed: [] });
	});

	it('changes nothing when run a second time', () => {
		const before = ['booking', 'retired', 'production'].map((id) => grantsOf(db, id));
		const audits = auditCount(db);
		runBackfill(db);
		expect(['booking', 'retired', 'production'].map((id) => grantsOf(db, id))).toEqual(before);
		expect(auditCount(db)).toBe(audits);
	});
});
