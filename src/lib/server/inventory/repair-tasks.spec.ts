import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A repair report opens a task, or joins the one open on its unit (#2756).
 * Against a real SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: async (key: string) => (key === 'inventory.repairRoleId' ? 'tech' : '')
}));

const { raiseFlag, reportBuildingProblem, sendUntriagedToRepair } =
	await import('./work-request-service');

const tasks = () =>
	sqlite
		.prepare(`select id, title, volunteer_role_id, source from work_order order by rowid`)
		.all() as { id: string; title: string; volunteer_role_id: string | null; source: string }[];
const reports = () =>
	sqlite.prepare(`select id, work_order_id from work_request order by rowid`).all() as {
		id: string;
		work_order_id: string | null;
	}[];

beforeEach(() => {
	sqlite.exec(`
		delete from work_order_link; delete from work_request; delete from work_order;
		delete from stock_movement; delete from inventory_asset; delete from inventory_item;
		delete from equipment_category; delete from volunteer_role; delete from "user";
		insert into "user" (id, name, email) values ('m', 'Member', 'm@example.com');
		insert into volunteer_role (id, name) values ('tech', 'Tech');
		insert into equipment_category (id, name, pricing_tier) values ('amps', 'Amps', 'major');
		insert into inventory_item (id, name, category_id, kind) values ('item', 'Bass amp', 'amps', 'serialized');
		insert into inventory_asset (id, item_id, asset_tag, condition) values ('unit', 'item', 'A-7', 'good');
	`);
});

const report = (note: string) =>
	raiseFlag({ assetId: 'unit', note, reportedByUserId: 'm', blocksUse: false });

describe('repair tasks', () => {
	it('a report opens a task linked to its unit, in the configured role', async () => {
		const flag = await report('Crackles');
		expect(tasks()).toEqual([
			{
				id: flag.workOrderId,
				title: 'Repair Bass amp (A-7)',
				volunteer_role_id: 'tech',
				source: 'repair'
			}
		]);
		expect(sqlite.prepare(`select asset_id from work_order_link`).all()).toEqual([
			{ asset_id: 'unit' }
		]);
	});

	it('a second report joins the open task', async () => {
		const first = await report('Crackles');
		const second = await report('Hums');
		expect(second.workOrderId).toBe(first.workOrderId);
		expect(tasks()).toHaveLength(1);
	});

	it('joins a task staff opened by hand on the unit', async () => {
		sqlite.exec(`
			insert into work_order (id, title) values ('hand', 'Retube');
			insert into work_order_link (id, work_order_id, asset_id) values ('l', 'hand', 'unit');
		`);
		expect((await report('Crackles')).workOrderId).toBe('hand');
	});

	it('opens a new task once the last one is done', async () => {
		const first = await report('Crackles');
		sqlite.exec(`update work_order set resolved_at = unixepoch()`);
		expect((await report('Again')).workOrderId).not.toBe(first.workOrderId);
	});

	it('a building problem opens its own task with no unit', async () => {
		const a = await reportBuildingProblem({
			location: 'Bathroom',
			note: 'Leaks',
			reportedByUserId: 'm'
		});
		const b = await reportBuildingProblem({
			location: 'Bathroom',
			note: 'No soap',
			reportedByUserId: 'm'
		});
		expect(a.workOrderId).not.toBe(b.workOrderId);
		expect(tasks().map((t) => t.title)).toEqual(['Repair Bathroom', 'Repair Bathroom']);
		expect(sqlite.prepare(`select count(*) n from work_order_link`).get()).toEqual({ n: 0 });
	});

	it('the backfill sends reports already waiting, once', async () => {
		sqlite.exec(`
			insert into work_request (id, asset_id, note, reported_by_user_id, status)
				values ('r1', 'unit', 'Crackles', 'm', 'pending'), ('r2', 'unit', 'Hums', 'm', 'pending');
			insert into work_request (id, location, note, reported_by_user_id, status)
				values ('r3', 'Hall', 'Dark', 'm', 'pending');
		`);
		expect(await sendUntriagedToRepair()).toBe(2);
		expect(await sendUntriagedToRepair()).toBe(0);
		const [r1, r2, r3] = reports();
		expect(r1.work_order_id).toBeTruthy();
		expect(r2.work_order_id).toBe(r1.work_order_id);
		expect(r3.work_order_id).not.toBe(r1.work_order_id);
		expect(tasks()).toHaveLength(2);
	});
});
