/**
 * #2611 retires the Renewals module. The cleanup removes every row that pointed at
 * it — grants, notification switches, sent reminders, certificate attachments —
 * and leaves its neighbours alone. Runs it on a migrated scratch file, then again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_retire_renewal_grants'));
const CLEANUP = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runCleanup(db: DatabaseSync) {
	for (const statement of CLEANUP.split('--> statement-breakpoint')) db.exec(statement);
}

const column = (db: DatabaseSync, sql: string) =>
	(db.prepare(sql).all() as Array<{ v: string }>).map((r) => r.v).sort();

describe('retire renewal grants', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-retire-renewals-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec(`
			INSERT INTO "user" (id, name, email) VALUES ('u1', 'Staff', 'staff@example.com');
			INSERT INTO "group" (id, kind, name, slug) VALUES
				('dev', 'committee', 'Development Committee', 'development-committee');
			INSERT INTO group_capability (group_id, capability) VALUES
				('dev', 'renewal.read'), ('dev', 'renewal.manage'),
				('dev', 'sponsor.read'), ('dev', 'grant.manage');
			INSERT INTO volunteer_role (id, name) VALUES ('admin', 'Administration');
			INSERT INTO volunteer_role_capability (volunteer_role_id, capability) VALUES
				('admin', 'renewal.manage'), ('admin', 'incident.file');
			INSERT INTO notification_preference (id, user_id, notification_type) VALUES
				('p1', 'u1', 'renewal_expiry'), ('p2', 'u1', 'ballot_result');
			INSERT INTO reminder_sent (id, reminder_key, subject_type, subject_id) VALUES
				('r1', 'renewal_expiry_60d', 'renewal', 'x:2026-12-01'),
				('r2', 'loan_overdue_1d', 'loan', 'l1');
			INSERT INTO media (id, key, content_type, byte_size) VALUES
				('m1', 'renewals/x/a.pdf', 'application/pdf', 1),
				('m2', 'sponsors/s/logo.png', 'image/png', 1);
			INSERT INTO media_attachment (id, media_id, attachable_type, attachable_id, slot) VALUES
				('a1', 'm1', 'renewal', 'x', 'certificate'),
				('a2', 'm2', 'sponsor', 's', 'logo');
		`);
		runCleanup(db);
	});

	it('drops renewal.* from committees and roles, keeping their other grants', () => {
		expect(column(db, `SELECT capability AS v FROM group_capability`)).toEqual([
			'grant.manage',
			'sponsor.read'
		]);
		expect(column(db, `SELECT capability AS v FROM volunteer_role_capability`)).toEqual([
			'incident.file'
		]);
	});

	it('drops the renewal notification switch and sent reminders only', () => {
		expect(column(db, `SELECT notification_type AS v FROM notification_preference`)).toEqual([
			'ballot_result'
		]);
		expect(column(db, `SELECT subject_type AS v FROM reminder_sent`)).toEqual(['loan']);
	});

	it('detaches certificates but keeps their media rows for the sweep to reap', () => {
		expect(column(db, `SELECT attachable_type AS v FROM media_attachment`)).toEqual(['sponsor']);
		expect(column(db, `SELECT id AS v FROM media`)).toEqual(['m1', 'm2']);
	});

	it('changes nothing on a second run', () => {
		const before = column(db, `SELECT capability AS v FROM group_capability`);
		runCleanup(db);
		expect(column(db, `SELECT capability AS v FROM group_capability`)).toEqual(before);
	});

	it('leaves no renewal table behind', () => {
		expect(column(db, `SELECT name AS v FROM sqlite_master WHERE name = 'renewal'`)).toEqual([]);
	});
});
