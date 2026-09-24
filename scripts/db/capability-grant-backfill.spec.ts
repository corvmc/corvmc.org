/**
 * The one-time capability-grant backfill preserves what committees and show crew
 * could do before #1647 and #1650. Seeds that state on a migrated scratch file,
 * runs the backfill, and runs it again to show the second run changes nothing.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_capability_grant_backfill'));
const BACKFILL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runBackfill(db: DatabaseSync) {
	for (const statement of BACKFILL.split('--> statement-breakpoint')) db.exec(statement);
}

const grantsOf = (db: DatabaseSync, table: 'group' | 'volunteer_role', id: string) =>
	(
		JSON.parse(
			(
				db.prepare(`SELECT capability_grants AS g FROM "${table}" WHERE id = ?`).get(id) as {
					g: string;
				}
			).g
		) as string[]
	).sort();

const auditCount = (db: DatabaseSync) =>
	(db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('capability grant backfill', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-backfill-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`
			INSERT INTO "user" (id, name, email) VALUES ('u1', 'Staff', 'staff@example.com');
			INSERT INTO "group" (id, kind, name, slug) VALUES
				('booking', 'committee', 'Booking Committee', 'booking-committee'),
				('market', 'committee', 'Market Committee', 'market-committee'),
				('idle', 'committee', 'Idle Committee', 'idle-committee'),
				('dev', 'committee', 'Development Committee', 'development-committee'),
				('band', 'band', 'Some Band', 'some-band');
			UPDATE "group" SET capability_grants = '["sponsor.read"]' WHERE id = 'booking';
			INSERT INTO project (id, name, group_id) VALUES
				('p-booking', 'Fall season', 'booking'),
				('p-market', 'Winter market', 'market'),
				('p-band', 'Band record', 'band');
			INSERT INTO event_listing (id, title, starts_at, ends_at, project_id, created_by_user_id) VALUES
				('ev-show', 'A show', 1790000000, 1790010000, 'p-booking', 'u1'),
				('ev-market', 'Market day', 1790000000, 1790010000, 'p-market', 'u1');
			INSERT INTO market_day (event_id) VALUES ('ev-market');
			INSERT INTO volunteer_role (id, name) VALUES
				('door', 'Door'),
				('photo', 'Photos or Video'),
				('repair', 'Gear Repair');
			INSERT INTO work_order (id, volunteer_role_id, event_id) VALUES
				('wo-door', 'door', 'ev-show'),
				('wo-repair', 'repair', NULL);
		`);
		runBackfill(db);
	});

	it('gives every committee that owns a project each power the guards now gate, merged in', () => {
		expect(grantsOf(db, 'group', 'booking')).toEqual([
			'event.publish',
			'finance.read',
			'project.manage',
			'sponsor.read',
			'volunteer.manageShifts'
		]);
	});

	it('gives the market-owning committee vendor decisions too', () => {
		expect(grantsOf(db, 'group', 'market')).toContain('event.manage');
		expect(grantsOf(db, 'group', 'booking')).not.toContain('event.manage');
	});

	it('gives Development sponsors, grants and renewals, and nothing to a committee without projects', () => {
		expect(grantsOf(db, 'group', 'dev')).toEqual([
			'grant.manage',
			'grant.read',
			'renewal.manage',
			'renewal.read',
			'sponsor.manage',
			'sponsor.read'
		]);
		expect(grantsOf(db, 'group', 'idle')).toEqual([]);
		expect(grantsOf(db, 'group', 'band')).toEqual([]);
	});

	it('gives incident filing to roles on event work orders, and recap uploads to photo roles', () => {
		expect(grantsOf(db, 'volunteer_role', 'door')).toEqual(['incident.file']);
		expect(grantsOf(db, 'volunteer_role', 'photo')).toEqual(['event.uploadRecap']);
		expect(grantsOf(db, 'volunteer_role', 'repair')).toEqual([]);
	});

	it('audits each change, naming what was added', () => {
		const row = db
			.prepare(
				`SELECT subject_type AS t, details AS d, actor_name AS a FROM audit_log WHERE subject_id = 'booking'`
			)
			.get() as { t: string; d: string; a: string };
		expect(row.t).toBe('group');
		expect(row.a).toBe('System');
		expect((JSON.parse(row.d) as { added: string[] }).added.sort()).toEqual([
			'event.publish',
			'finance.read',
			'project.manage',
			'volunteer.manageShifts'
		]);
		expect(auditCount(db)).toBe(5);
	});

	it('changes nothing when run a second time', () => {
		const before = ['booking', 'market', 'dev'].map((id) => grantsOf(db, 'group', id));
		const audits = auditCount(db);
		runBackfill(db);
		expect(['booking', 'market', 'dev'].map((id) => grantsOf(db, 'group', id))).toEqual(before);
		expect(auditCount(db)).toBe(audits);
	});
});
