import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { migratedSqlite } from '$lib/server/testing/migrated-sqlite';

/** The #2033 backfill copies each list's anchor and trigger onto what it already stamped. */

const [backfill] = globSync('migrations/*_backfill_work_order_anchor/migration.sql');

function run() {
	const { sqlite } = migratedSqlite({ through: 'robust_jocasta' });
	// An earlier migration seeds the default show list.
	sqlite.exec(`
		delete from duty_list;
		insert into duty_list (id, name, anchor, subject, auto_apply_on) values
			('show', 'Show deliverables', 'start', 'event', 'production.created'),
			('orient', 'Orientation', 'start', 'reservation', 'reservation.first');
		insert into work_order (id, duty_list_id, reservation_id) values
			('wo-show', 'show', null),
			('wo-orient', 'orient', 'res-1'),
			('wo-hand', null, 'res-2'),
			('wo-booked', null, 'res-3'),
			('wo-plain', null, null);
		insert into member_orientation (id, user_id, work_order_id) values ('mo-1', 'u-1', 'wo-booked');
	`);
	for (const statement of readFileSync(backfill, 'utf8').split('--> statement-breakpoint')) {
		sqlite.exec(statement);
	}
	return sqlite.prepare(`select id, anchor, is_orientation from work_order order by id`).all() as {
		id: string;
		anchor: string | null;
		is_orientation: number;
	}[];
}

describe('backfill_work_order_anchor', () => {
	it('stamps the anchor from the list and marks orientation shifts', () => {
		expect(run()).toEqual([
			{ id: 'wo-booked', anchor: null, is_orientation: 1 },
			{ id: 'wo-hand', anchor: null, is_orientation: 0 },
			{ id: 'wo-orient', anchor: 'start', is_orientation: 1 },
			{ id: 'wo-plain', anchor: null, is_orientation: 0 },
			{ id: 'wo-show', anchor: 'start', is_orientation: 0 }
		]);
	});
});
