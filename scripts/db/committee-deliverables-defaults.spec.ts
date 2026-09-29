/**
 * #1701: a show's default deliverables. The migration adds the four roles, the
 * `Show deliverables` list with its nine owned items, and `volunteer.manageShifts`
 * for the four committees that own them. It finds each committee by slug, then
 * by name, leaves an item unowned when its committee is missing, audits every
 * grant, and changes nothing when run a second time.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) =>
	n.endsWith('_committee_deliverables_defaults')
);
const SQL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function run(db: DatabaseSync) {
	for (const statement of SQL.split('--> statement-breakpoint')) db.exec(statement);
}

/** Migrated, with the list's items cleared so the committees below are what it finds. */
function migrated(committees: string): DatabaseSync {
	const file = join(mkdtempSync(join(tmpdir(), 'corvmc-deliverables-')), 'd1.sqlite');
	applyMigrations(file);
	const db = new DatabaseSync(file);
	db.exec(`DELETE FROM duty_list_item; ${committees}`);
	return db;
}

const items = (db: DatabaseSync) =>
	db
		.prepare(
			`SELECT i.sort_order AS o, i.title AS t, g.slug AS owner, r.name AS role,
				i.due_offset_minutes AS due, i.done_when AS w, i.tasks AS tasks
			 FROM duty_list_item i
			 JOIN duty_list dl ON dl.id = i.duty_list_id
			 JOIN volunteer_role r ON r.id = i.volunteer_role_id
			 LEFT JOIN "group" g ON g.id = i.group_id
			 WHERE dl.auto_apply_on = 'production.created'
			 ORDER BY i.sort_order`
		)
		.all() as Array<{
		o: number;
		t: string;
		owner: string | null;
		role: string;
		due: number;
		w: string;
		tasks: string;
	}>;

const grants = (db: DatabaseSync) =>
	(
		db
			.prepare(
				`SELECT group_id AS g FROM group_capability WHERE capability = 'volunteer.manageShifts' ORDER BY group_id`
			)
			.all() as Array<{ g: string }>
	).map((r) => r.g);

const audits = (db: DatabaseSync) =>
	db
		.prepare(
			`SELECT subject_id AS id, actor_name AS a, details AS d FROM audit_log ORDER BY subject_id`
		)
		.all() as Array<{ id: string; a: string; d: string }>;

const ALL = `INSERT INTO "group" (id, name, slug, kind) VALUES
	('book', 'Booking Committee', 'booking-committee', 'committee'),
	('prod', 'Production Committee', 'production-committee', 'committee'),
	('comms', 'Communications Committee', 'comms', 'committee'),
	('art', 'Art and Merchandise Committee', 'art-and-merchandise-committee', 'committee'),
	('band', 'Booking Committee', 'a-band-named-that', 'band');`;

describe('the Show deliverables migration', () => {
	it('writes the list, auto-applied to a new show and anchored at its start', () => {
		const db = migrated('');
		const lists = db
			.prepare(`SELECT name, anchor, subject, auto_apply_on AS on_ FROM duty_list`)
			.all();
		expect(lists).toEqual([
			{ name: 'Show deliverables', anchor: 'start', subject: 'event', on_: 'production.created' }
		]);
		const roles = db
			.prepare(`SELECT name FROM volunteer_role WHERE "group" = 'away-from-shows' ORDER BY name`)
			.all();
		expect(roles).toEqual(
			expect.arrayContaining(
				['Booking Lead', 'Poster Art', 'Production Lead', 'Show Promotion'].map((name) => ({
					name
				}))
			)
		);
	});

	it('owns each item by slug, then by name, and never by a band', () => {
		const db = migrated(ALL);
		run(db);
		const rows = items(db);
		expect(rows.map((r) => [r.o, r.owner, r.role, r.due, r.w])).toEqual([
			[10, 'booking-committee', 'Booking Lead', -40320, 'production_confirmed'],
			[20, 'booking-committee', 'Booking Lead', -30240, 'artifacts_requested'],
			[30, 'art-and-merchandise-committee', 'Poster Art', -30240, 'poster_set'],
			[40, 'booking-committee', 'Booking Lead', -30240, 'description_set'],
			[50, 'comms', 'Show Promotion', -20160, 'event_published'],
			[60, 'production-committee', 'Production Lead', -10080, 'tasks_ticked'],
			[70, 'production-committee', 'Production Lead', -4320, 'shifts_filled'],
			[80, 'production-committee', 'Production Lead', 720, 'close_out_done'],
			[90, 'production-committee', 'Production Lead', 4320, 'production_settled']
		]);
		expect(JSON.parse(rows[4].tasks)).toEqual([
			'Poster distributed',
			'Announced on social',
			'Sent to press',
			'In the newsletter'
		]);
		expect(JSON.parse(rows[5].tasks)).toHaveLength(4);
	});

	it('leaves a missing committee’s items unowned rather than failing', () => {
		const db = migrated(`INSERT INTO "group" (id, name, slug, kind) VALUES
			('book', 'Booking Committee', 'booking-committee', 'committee');`);
		run(db);
		const rows = items(db);
		expect(rows).toHaveLength(9);
		expect(rows.filter((r) => r.owner === null).map((r) => r.o)).toEqual([30, 50, 60, 70, 80, 90]);
	});

	it('grants volunteer.manageShifts where missing, audited by System', () => {
		const db = migrated(`${ALL}
			INSERT INTO group_capability (group_id, capability) VALUES ('prod', 'volunteer.manageShifts');`);
		run(db);
		expect(grants(db)).toEqual(['art', 'book', 'comms', 'prod']);
		const rows = audits(db);
		expect(rows.map((r) => r.id)).toEqual(['art', 'book', 'comms']);
		expect(rows.every((r) => r.a === 'System')).toBe(true);
		expect(JSON.parse(rows[0].d)).toEqual({ added: ['volunteer.manageShifts'], removed: [] });
	});

	it('changes nothing on a second run', () => {
		const db = migrated(ALL);
		run(db);
		const before = { items: items(db), grants: grants(db), audits: audits(db).length };
		const roles = db.prepare(`SELECT count(*) AS n FROM volunteer_role`).get();
		run(db);
		expect(items(db)).toEqual(before.items);
		expect(grants(db)).toEqual(before.grants);
		expect(audits(db)).toHaveLength(before.audits);
		expect(db.prepare(`SELECT count(*) AS n FROM volunteer_role`).get()).toEqual(roles);
	});
});
