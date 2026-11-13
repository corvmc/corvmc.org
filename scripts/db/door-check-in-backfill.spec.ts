/**
 * #2794 gates the door list on `event.checkIn` carried by the shift's role. The backfill
 * adds it to every role that already takes card payments at the door (`finance.collect`),
 * leaving its other grants alone. Runs it on a migrated scratch file, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) =>
	n.endsWith('_door_role_event_check_in_backfill')
);
const BACKFILL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runBackfill(db: DatabaseSync) {
	for (const statement of BACKFILL.split('--> statement-breakpoint')) db.exec(statement);
}

const grantsOf = (db: DatabaseSync, id: string) =>
	(
		db
			.prepare(
				`SELECT capability AS c FROM volunteer_role_capability WHERE volunteer_role_id = ? ORDER BY capability`
			)
			.all(id) as Array<{ c: string }>
	).map((r) => r.c);

const auditCount = (db: DatabaseSync) =>
	(db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('event.checkIn door-role backfill', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-door-check-in-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`
			INSERT INTO volunteer_role (id, name) VALUES
				('door', 'Door'),
				('has', 'Door lead'),
				('desk', 'Front Desk');
			INSERT INTO volunteer_role_capability (volunteer_role_id, capability) VALUES
				('door', 'finance.collect'),
				('has', 'finance.collect'),
				('has', 'event.checkIn'),
				('desk', 'incident.file');
		`);
		runBackfill(db);
	});

	it('adds event.checkIn to every role that takes door payments, keeping existing grants', () => {
		expect(grantsOf(db, 'door')).toEqual(['event.checkIn', 'finance.collect']);
		expect(grantsOf(db, 'has')).toEqual(['event.checkIn', 'finance.collect']);
	});

	it('leaves a role without door payments alone', () => {
		expect(grantsOf(db, 'desk')).toEqual(['incident.file']);
	});

	it('audits each role it changed, by System', () => {
		const rows = db
			.prepare(
				`SELECT subject_id AS id, subject_type AS t, actor_name AS a, details AS d FROM audit_log ORDER BY subject_id`
			)
			.all() as Array<{ id: string; t: string; a: string; d: string }>;
		expect(rows.map((r) => r.id)).toEqual(['door']);
		expect(rows.every((r) => r.t === 'role' && r.a === 'System')).toBe(true);
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['event.checkIn'], removed: [] });
	});

	it('changes nothing when run a second time', () => {
		const ids = ['door', 'has', 'desk'];
		const before = ids.map((id) => grantsOf(db, id));
		const audits = auditCount(db);
		runBackfill(db);
		expect(ids.map((id) => grantsOf(db, id))).toEqual(before);
		expect(auditCount(db)).toBe(audits);
	});
});
