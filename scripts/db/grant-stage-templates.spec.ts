/**
 * #2622: the three grant templates. The migration adds the Grant Writer role and
 * one template per stage, each item owned by the live committee holding
 * `grant.manage` (Development first), unowned when there is none, and changes
 * nothing when run a second time.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_grant_stage_templates'));
const SQL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function run(db: DatabaseSync) {
	for (const statement of SQL.split('--> statement-breakpoint')) db.exec(statement);
}

/** Migrated, with the templates' items cleared so the committees below are what it finds. */
function migrated(committees: string): DatabaseSync {
	const file = join(mkdtempSync(join(tmpdir(), 'corvmc-grant-stages-')), 'd1.sqlite');
	applyMigrations(file);
	const db = new DatabaseSync(file);
	db.exec(`DELETE FROM duty_list_item WHERE duty_list_id IN
		(SELECT id FROM duty_list WHERE grant_stage IS NOT NULL); ${committees}`);
	return db;
}

const owners = (db: DatabaseSync) =>
	db
		.prepare(
			`SELECT DISTINCT i.group_id AS owner FROM duty_list_item i
			 JOIN duty_list d ON d.id = i.duty_list_id WHERE d.grant_stage IS NOT NULL`
		)
		.all()
		.map((r) => (r as { owner: string | null }).owner);

const counts = (db: DatabaseSync) =>
	db
		.prepare(
			`SELECT d.grant_stage AS stage, d.anchor, count(i.id) AS n FROM duty_list d
			 LEFT JOIN duty_list_item i ON i.duty_list_id = d.id
			 WHERE d.grant_stage IS NOT NULL GROUP BY d.id ORDER BY d.grant_stage`
		)
		.all();

describe('the grant stage templates migration', () => {
	it('writes one template per stage, timed from the grant date it names', () => {
		const db = migrated('');
		run(db);
		expect(counts(db)).toEqual([
			{ stage: 'application', anchor: 'apply_by', n: 6 },
			{ stage: 'award', anchor: 'award_start', n: 3 },
			{ stage: 'close_out', anchor: 'award_end', n: 2 }
		]);
	});

	it('owns every item by the committee holding grant.manage, Development first', () => {
		const db = migrated(`
			INSERT INTO "group" (id, kind, name, slug) VALUES
				('board', 'committee', 'Board', 'board'),
				('dev', 'committee', 'Development Committee', 'development-committee'),
				('band', 'band', 'A Band', 'a-band');
			INSERT INTO group_capability (group_id, capability) VALUES
				('board', 'grant.manage'), ('dev', 'grant.manage'), ('band', 'grant.manage');`);
		run(db);
		expect(owners(db)).toEqual(['dev']);
	});

	it('leaves the items unowned when no committee holds grant.manage', () => {
		const db = migrated(`
			INSERT INTO "group" (id, kind, name, slug) VALUES ('band', 'band', 'A Band', 'a-band');
			INSERT INTO group_capability (group_id, capability) VALUES ('band', 'grant.manage');`);
		run(db);
		expect(owners(db)).toEqual([null]);
	});

	it('changes nothing on a second run', () => {
		const db = migrated('');
		run(db);
		const before = counts(db);
		run(db);
		expect(counts(db)).toEqual(before);
		expect(
			db.prepare(`SELECT count(*) AS n FROM volunteer_role WHERE name = 'Grant Writer'`).get()
		).toEqual({ n: 1 });
	});
});
