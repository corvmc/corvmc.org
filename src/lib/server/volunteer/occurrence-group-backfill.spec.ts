import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { migratedSqlite } from '#lib/server/testing/migrated-sqlite.js';

/** The #2987 backfill gives open occurrences their schedule's committee. */

const [backfill] = globSync('migrations/*_backfill_occurrence_group/migration.sql');

function run() {
	const { sqlite } = migratedSqlite({ through: 'steep_miss_america' });
	sqlite.exec(`
		insert into volunteer_role (id, name) values ('role', 'Cleaner');
		insert into "group" (id, name, slug) values ('comm', 'Space', 'space'), ('other', 'Gear', 'gear');
		insert into maintenance_schedule (id, name, volunteer_role_id, group_id, interval_days) values
			('ms-comm', 'Deep clean', 'role', 'comm', 30),
			('ms-moved', 'Restring', 'role', 'comm', 30),
			('ms-staff', 'PA check', 'role', null, 30);
		insert into work_order (id, maintenance_schedule_id, group_id, resolved_at, cancelled_at) values
			('wo-open', 'ms-comm', null, null, null),
			('wo-done', 'ms-comm', null, 1, null),
			('wo-off', 'ms-comm', null, null, 1),
			('wo-set', 'ms-moved', 'other', null, null),
			('wo-staff', 'ms-staff', null, null, null),
			('wo-plain', null, null, null, null);
	`);
	sqlite.exec(readFileSync(backfill, 'utf8'));
	return sqlite.prepare(`select id, group_id from work_order order by id`).all();
}

describe('backfill_occurrence_group', () => {
	it("sets the schedule's committee on open occurrences that have none", () => {
		expect(run()).toEqual([
			{ id: 'wo-done', group_id: null },
			{ id: 'wo-off', group_id: null },
			{ id: 'wo-open', group_id: 'comm' },
			{ id: 'wo-plain', group_id: null },
			{ id: 'wo-set', group_id: 'other' },
			{ id: 'wo-staff', group_id: null }
		]);
	});
});
