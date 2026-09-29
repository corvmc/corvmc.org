/**
 * The #1700 backfill keeps every pending request and committee application when
 * the two flows become one. Seeds both on a migrated scratch file, runs the
 * backfill, and runs it again to show the second run changes nothing.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_group_application_backfill'));
const BACKFILL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

/** Migrations up to, not including, the backfill: the state it meets in production. */
function migrationsBeforeBackfill(): string {
	const out = mkdtempSync(join(tmpdir(), 'corvmc-group-app-migrations-'));
	for (const tag of readdirSync(MIGRATIONS_FOLDER)) {
		if (/^\d{14}_/.test(tag) && dir && tag < dir) {
			cpSync(join(MIGRATIONS_FOLDER, tag), join(out, tag), { recursive: true });
		}
	}
	return out;
}

function runBackfill(db: DatabaseSync) {
	for (const statement of BACKFILL.split('--> statement-breakpoint')) db.exec(statement);
}

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
const count = (db: DatabaseSync, table: string) =>
	(db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('group application backfill', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-group-app-')), 'd1.sqlite');
		applyMigrations(file, migrationsBeforeBackfill());
		db = new DatabaseSync(file);
		db.exec(`
			INSERT INTO "user" (id, name, email) VALUES
				('ada', 'Ada', 'ada@example.com'),
				('bo', 'Bo', 'bo@example.com'),
				('cy', 'Cy', 'cy@example.com'),
				('chair', 'Chair', 'chair@example.com');
			INSERT INTO "group" (id, kind, name, slug, join_policy) VALUES
				('booking', 'committee', 'Booking Committee', 'booking-committee', 'invite_only'),
				('facility', 'committee', 'Facility Committee', 'facility-committee', 'by_application'),
				('jazz', 'club', 'Jazz Club', 'jazz-club', 'by_application'),
				('drop', 'club', 'Drop-in Club', 'drop-in-club', 'open'),
				('band', 'band', 'Some Band', 'some-band', 'invite_only');
			INSERT INTO committee_application (id, user_id, answers, withdrawn_at, created_at, updated_at) VALUES
				('ca-1', 'ada', '{"experience":"Booked shows"}', NULL, 1780000000, 1780000100),
				('ca-2', 'bo', '{}', 1780000500, 1780000200, 1780000500);
			INSERT INTO committee_application_choice
				(id, application_id, group_id, status, review_notes, decided_by_user_id, decided_at, created_at, updated_at) VALUES
				('cc-1', 'ca-1', 'booking', 'submitted', NULL, NULL, NULL, 1780000000, 1780000000),
				('cc-2', 'ca-1', 'facility', 'declined', 'Next round', 'chair', 1780000300, 1780000000, 1780000300),
				('cc-3', 'ca-2', 'booking', 'submitted', NULL, NULL, NULL, 1780000200, 1780000200);
			INSERT INTO group_member (id, group_id, user_id, role, status, created_at) VALUES
				('gm-chair', 'jazz', 'chair', 'owner', 'active', 1770000000),
				('gm-bo', 'jazz', 'bo', 'member', 'requested', 1781000000),
				('gm-cy', 'facility', 'cy', 'member', 'requested', 1782000000),
				('gm-ada', 'booking', 'ada', 'member', 'requested', 1783000000),
				('gm-invite', 'jazz', 'cy', 'member', 'pending', 1784000000);
		`);
		runBackfill(db);
	});

	it('copies every committee application and choice, keeping ids, answers and decisions', () => {
		expect(
			all(
				db,
				`SELECT id, user_id, answers, withdrawn_at FROM group_application WHERE id LIKE 'ca-%' ORDER BY id`
			)
		).toEqual([
			{ id: 'ca-1', user_id: 'ada', answers: '{"experience":"Booked shows"}', withdrawn_at: null },
			{ id: 'ca-2', user_id: 'bo', answers: '{}', withdrawn_at: 1780000500 }
		]);
		expect(
			all(
				db,
				`SELECT id, group_id, status, review_notes, decided_by_user_id FROM group_application_choice WHERE id LIKE 'cc-%' ORDER BY id`
			)
		).toEqual([
			{
				id: 'cc-1',
				group_id: 'booking',
				status: 'submitted',
				review_notes: null,
				decided_by_user_id: null
			},
			{
				id: 'cc-2',
				group_id: 'facility',
				status: 'declined',
				review_notes: 'Next round',
				decided_by_user_id: 'chair'
			},
			{
				id: 'cc-3',
				group_id: 'booking',
				status: 'submitted',
				review_notes: null,
				decided_by_user_id: null
			}
		]);
	});

	it('turns each requested roster row into an open application, keeping when it was made', () => {
		const moved = all(
			db,
			`SELECT a.id, a.user_id, a.answers, a.created_at, c.group_id, c.status
			 FROM group_application a JOIN group_application_choice c ON c.application_id = a.id
			 WHERE a.id LIKE 'migrated-request-%' ORDER BY a.id`
		);
		expect(moved).toEqual([
			{
				id: 'migrated-request-gm-bo',
				user_id: 'bo',
				answers: '{}',
				created_at: 1781000000,
				group_id: 'jazz',
				status: 'submitted'
			},
			{
				id: 'migrated-request-gm-cy',
				user_id: 'cy',
				answers: '{}',
				created_at: 1782000000,
				group_id: 'facility',
				status: 'submitted'
			}
		]);
	});

	it('does not double a request already covered by an open committee application', () => {
		// Ada's `requested` Booking row and her open Booking choice are one ask.
		const adaBooking = all(
			db,
			`SELECT c.id FROM group_application_choice c JOIN group_application a ON a.id = c.application_id
			 WHERE a.user_id = 'ada' AND c.group_id = 'booking'`
		);
		expect(adaBooking).toEqual([{ id: 'cc-1' }]);
	});

	it('deletes the requested rows and leaves memberships and invitations alone', () => {
		expect(all(db, `SELECT id FROM group_member ORDER BY id`)).toEqual([
			{ id: 'gm-chair' },
			{ id: 'gm-invite' }
		]);
	});

	it('makes every committee take applications, and touches no other kind', () => {
		expect(all(db, `SELECT id, join_policy FROM "group" ORDER BY id`)).toEqual([
			{ id: 'band', join_policy: 'invite_only' },
			{ id: 'booking', join_policy: 'by_application' },
			{ id: 'drop', join_policy: 'open' },
			{ id: 'facility', join_policy: 'by_application' },
			{ id: 'jazz', join_policy: 'by_application' }
		]);
	});

	it('changes nothing when run a second time', () => {
		const before = [count(db, 'group_application'), count(db, 'group_application_choice')];
		runBackfill(db);
		expect([count(db, 'group_application'), count(db, 'group_application_choice')]).toEqual(before);
		expect(before).toEqual([4, 5]);
	});
});
