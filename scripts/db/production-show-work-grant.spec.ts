/**
 * #2959 moves show work from production.book to production.run and makes
 * production.book org-wide. The grant gives every committee holding
 * production.book production.run too, so moving the guards strips nobody.
 * Runs it on a migrated scratch file, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_production_show_work_grant'));
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

describe('production show-work grant', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-show-work-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`DELETE FROM group_capability; DELETE FROM audit_log;`);
		db.exec(`
			INSERT INTO "group" (id, name, slug, kind) VALUES
				('book', 'Booking Committee', 'booking-x', 'committee'),
				('both', 'Both', 'both-x', 'committee'),
				('prod', 'Production Committee', 'production-x', 'committee'),
				('band', 'A band', 'a-band-x', 'band');
			INSERT INTO group_capability (group_id, capability) VALUES
				('book', 'production.book'), ('book', 'production.create'),
				('both', 'production.book'), ('both', 'production.run'),
				('prod', 'production.run'),
				('band', 'production.book');
		`);
		runGrant(db);
	});

	it('gives a committee holding production.book production.run beside it', () => {
		expect(grantsOf(db, 'book')).toEqual([
			'production.book',
			'production.create',
			'production.run'
		]);
	});

	it('leaves committees that already hold it, or never booked, as they were', () => {
		expect(grantsOf(db, 'both')).toEqual(['production.book', 'production.run']);
		expect(grantsOf(db, 'prod')).toEqual(['production.run']);
		expect(grantsOf(db, 'band')).toEqual(['production.book']);
	});

	it('audits only the committee it changed, by System', () => {
		const rows = db
			.prepare(`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log`)
			.all() as Array<{ id: string; a: string; d: string }>;
		expect(rows.map((r) => r.id)).toEqual(['book']);
		expect(rows[0].a).toBe('System');
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['production.run'], removed: [] });
	});

	it('changes nothing when run a second time', () => {
		const ids = ['book', 'both', 'prod', 'band'];
		const before = ids.map((id) => grantsOf(db, id));
		const audits = auditCount(db);
		runGrant(db);
		expect(ids.map((id) => grantsOf(db, id))).toEqual(before);
		expect(auditCount(db)).toBe(audits);
	});
});
