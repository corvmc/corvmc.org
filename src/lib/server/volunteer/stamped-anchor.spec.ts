import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * A stamped work order keeps the anchor and orientation facts it was stamped
 * with (#2033). Editing, re-triggering or deleting the duty list afterwards
 * must not change how retime, close-out or orientation treat it.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			sqlite.exec('begin');
			try {
				const out = [];
				for (const s of stmts) out.push(await s);
				sqlite.exec('commit');
				return out;
			} catch (e) {
				sqlite.exec('rollback');
				throw e;
			}
		}
	})
}));

const { applyDutyList } = await import('./duty-list-service');
const { shiftAnchoredWorkOrders } = await import('./retime-work-orders');
const { outstandingCloseOutTasks } = await import('$lib/server/production/production-service');
const { orientationOwnerOf, orientationForReservation } = await import('./orientation-service');

const all = (q: string) => sqlite.prepare(q).all() as Record<string, unknown>[];
const START = Date.UTC(2026, 10, 7, 3, 0) / 1000;

beforeEach(() => {
	for (const t of [
		'work_task',
		'work_order',
		'duty_list_item',
		'duty_list',
		'event_listing',
		'production',
		'reservation',
		'project_section',
		'project',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into user (id, name, email) values ('u-1', 'Nia Okafor', 'nia@example.test');
		insert into volunteer_role (id, name) values ('role-1', 'Door');
		insert into project (id, name, kind) values ('proj-1', 'Saturday show', 'production');
		insert into production (id, project_id, load_out_by) values ('prod-1', 'proj-1', ${START + 4 * 3600});
		insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, project_id)
			values ('ev-1', 'Saturday show', ${START}, ${START + 3 * 3600}, 'u-1', 'proj-1');
		insert into reservation (id, booker_type, booker_id, created_by_user_id, starts_at, ends_at)
			values ('res-1', 'user', 'u-1', 'u-1', ${START}, ${START + 7200});
	`);
});

function list(id: string, anchor: string) {
	sqlite
		.prepare(`insert into duty_list (id, name, anchor, subject) values (?, ?, ?, 'project')`)
		.run(id, id, anchor);
	sqlite.exec(`
		insert into duty_list_item (id, duty_list_id, volunteer_role_id, offset_minutes, duration_minutes, tasks)
			values ('${id}-item', '${id}', 'role-1', 0, 60, '["Stack chairs"]');
	`);
}

describe('stamping', () => {
	it('copies the list anchor onto each work order', async () => {
		list('show', 'start');
		await applyDutyList('show', { kind: 'project', id: 'proj-1' }, 'u-1');

		// Offset 0 lands on the anchor instant exactly.
		expect(all(`select anchor, is_orientation, starts_at from work_order`)).toEqual([
			{ anchor: 'start', is_orientation: 0, starts_at: START }
		]);
	});
});

describe('retime reads the stamped anchor', () => {
	it('moves a start-anchored shift after the list is re-anchored', async () => {
		list('show', 'start');
		await applyDutyList('show', { kind: 'project', id: 'proj-1' }, 'u-1');
		sqlite.exec(`update duty_list set anchor = 'doors'`);

		await shiftAnchoredWorkOrders('ev-1', ['start'], sql`${1800}`);

		expect(all(`select starts_at from work_order`)).toEqual([{ starts_at: START + 1800 }]);
	});

	it('moves it after the list is deleted', async () => {
		list('show', 'start');
		await applyDutyList('show', { kind: 'project', id: 'proj-1' }, 'u-1');
		sqlite.exec(`delete from duty_list`);

		await shiftAnchoredWorkOrders('ev-1', ['start'], sql`${-600}`);

		expect(all(`select starts_at from work_order`)).toEqual([{ starts_at: START - 600 }]);
	});

	it('leaves a shift stamped at another anchor alone', async () => {
		list('show', 'doors');
		await applyDutyList('show', { kind: 'project', id: 'proj-1' }, 'u-1');
		sqlite.exec(`update duty_list set anchor = 'start'`);

		await shiftAnchoredWorkOrders('ev-1', ['start'], sql`${1800}`);

		expect(all(`select starts_at from work_order`)).toEqual([{ starts_at: START }]);
	});
});

describe('close-out reads the stamped anchor', () => {
	it('still counts load-out tasks after the list is re-anchored and deleted', async () => {
		list('lockup', 'load_out');
		await applyDutyList('lockup', { kind: 'project', id: 'proj-1' }, 'u-1');
		sqlite.exec(`update duty_list set anchor = 'start'`);
		expect(await outstandingCloseOutTasks('prod-1')).toEqual(['Stack chairs']);

		sqlite.exec(`delete from duty_list`);
		expect(await outstandingCloseOutTasks('prod-1')).toEqual(['Stack chairs']);
	});

	it('does not count a list re-anchored to load-out after it was stamped', async () => {
		list('show', 'start');
		await applyDutyList('show', { kind: 'project', id: 'proj-1' }, 'u-1');
		sqlite.exec(`update duty_list set anchor = 'load_out'`);

		expect(await outstandingCloseOutTasks('prod-1')).toEqual([]);
	});
});

describe('orientation reads the stamped marker', () => {
	// Raised from the orientation setting, so there is no list behind it at all.
	beforeEach(() => {
		sqlite.exec(`insert into work_order (id, reservation_id, starts_at, ends_at, is_orientation)
			values ('wo-orient', 'res-1', ${START}, ${START + 1800}, 1)`);
	});

	const shiftId = () => 'wo-orient';

	it('finds the shift by its marker, with no list behind it', async () => {
		expect(await orientationOwnerOf(shiftId())).toMatchObject({ userId: 'u-1' });
		expect(await orientationForReservation('res-1')).toMatchObject({ workOrderId: shiftId() });
	});

	it('ignores a booking work order that is not an orientation', async () => {
		sqlite.exec(`update work_order set is_orientation = 0`);

		expect(await orientationOwnerOf(shiftId())).toBeNull();
		expect(await orientationForReservation('res-1')).toBeNull();
	});
});
