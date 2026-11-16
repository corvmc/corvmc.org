/**
 * #2959 follow-up (a): Art and Merchandise and Communications hold
 * production.run. Runs the grant on a migrated scratch file, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_art_comms_production_run'));
const GRANT = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runGrant(db: DatabaseSync) {
	for (const statement of GRANT.split('--> statement-breakpoint')) db.exec(statement);
}

const grantsOf = (db: DatabaseSync, id: string) =>
	(
		db
			.prepare(
				`SELECT capability AS c FROM group_capability WHERE group_id = ? ORDER BY capability`
			)
			.all(id) as Array<{ c: string }>
	).map((r) => r.c);

const auditCount = (db: DatabaseSync) =>
	(db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;

describe('art and communications production.run grant', () => {
	let db: DatabaseSync;
	const ids = ['art', 'comms', 'held', 'other', 'club'];

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-art-comms-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`
			DELETE FROM group_capability; DELETE FROM audit_log;
			DELETE FROM "group" WHERE slug IN ('art-and-merchandise-committee', 'communications-committee');
		`);
		db.exec(`
			INSERT INTO "group" (id, name, slug, kind) VALUES
				('art', 'Art and Merchandise Committee', 'art-and-merchandise-committee', 'committee'),
				('comms', 'Communications Committee', 'communications-committee', 'committee'),
				('held', 'Production Committee', 'production-x', 'committee'),
				('other', 'Development Committee', 'development-x', 'committee'),
				('club', 'Communications', 'communications', 'club');
			INSERT INTO group_capability (group_id, capability) VALUES
				('art', 'volunteer.manageShifts'),
				('comms', 'volunteer.manageShifts'),
				('held', 'production.run');
		`);
		runGrant(db);
	});

	it('gives both committees production.run beside what they held', () => {
		expect(grantsOf(db, 'art')).toEqual(['production.run', 'volunteer.manageShifts']);
		expect(grantsOf(db, 'comms')).toEqual(['production.run', 'volunteer.manageShifts']);
	});

	it('leaves every other group as it was', () => {
		expect(grantsOf(db, 'held')).toEqual(['production.run']);
		expect(grantsOf(db, 'other')).toEqual([]);
		expect(grantsOf(db, 'club')).toEqual([]);
	});

	it('audits each committee it changed, by System', () => {
		const rows = db
			.prepare(`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log ORDER BY id`)
			.all() as Array<{ id: string; a: string; d: string }>;
		expect(rows.map((r) => r.id)).toEqual(['art', 'comms']);
		for (const row of rows) {
			expect(row.a).toBe('System');
			expect(JSON.parse(row.d)).toEqual({ added: ['production.run'], removed: [] });
		}
	});

	it('changes nothing when run a second time', () => {
		const before = ids.map((id) => grantsOf(db, id));
		const audits = auditCount(db);
		runGrant(db);
		expect(ids.map((id) => grantsOf(db, id))).toEqual(before);
		expect(auditCount(db)).toBe(audits);
	});
});
