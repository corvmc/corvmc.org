import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Low stock opens one task per item (#2756), linked to the item, and a placed
 * order or stock back above the reorder point closes it. Against a real SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const settings: Record<string, string> = { 'inventory.restockRoleId': '' };
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: async (key: string) => settings[key] ?? ''
}));

const { consumeStock, adjustStock } = await import('./acquisition-service');
const { createOrder, cancelOrder } = await import('./order-service');
const { syncRestockTasks } = await import('./restock-tasks');
const { listLowStock } = await import('./stock-service');

interface TaskRow {
	id: string;
	title: string;
	volunteer_role_id: string | null;
	resolved_at: number | null;
	resolution_notes: string | null;
}
const tasks = () =>
	sqlite
		.prepare(`select * from work_order where source = 'restock' order by created_at, rowid`)
		.all() as unknown as TaskRow[];
const open = () => tasks().filter((t) => t.resolved_at === null);

beforeEach(() => {
	sqlite.exec(`
		delete from work_order_link; delete from work_order; delete from purchase_order_line;
		delete from purchase_order; delete from stock_movement; delete from inventory_item;
		delete from equipment_category; delete from volunteer_role;
		insert into equipment_category (id, name, pricing_tier) values ('c', 'Strings', 'minor');
		insert into inventory_item (id, name, category_id, kind, reorder_point)
			values ('strings', 'Bass strings', 'c', 'bulk', 5);
		insert into stock_movement (id, item_id, quantity, reason, occurred_at, created_at)
			values ('m0', 'strings', 8, 'receive', 0, 0);
	`);
	settings['inventory.restockRoleId'] = '';
});

describe('restock tasks', () => {
	it('open once when stock reaches the reorder point, linked to the item', async () => {
		await consumeStock({ itemId: 'strings', quantity: 3 });
		await consumeStock({ itemId: 'strings', quantity: 1 });
		expect(open()).toHaveLength(1);
		expect(open()[0]).toMatchObject({ title: 'Restock Bass strings', volunteer_role_id: null });
		expect(sqlite.prepare(`select item_id from work_order_link`).all()).toEqual([
			{ item_id: 'strings' }
		]);
		expect((await listLowStock())[0].taskId).toBe(open()[0].id);
	});

	it('take the role the setting names', async () => {
		sqlite.exec(`insert into volunteer_role (id, name) values ('buyer', 'Buyer')`);
		settings['inventory.restockRoleId'] = 'buyer';
		await consumeStock({ itemId: 'strings', quantity: 3 });
		expect(open()[0].volunteer_role_id).toBe('buyer');
	});

	it('close when stock is back above the point', async () => {
		await consumeStock({ itemId: 'strings', quantity: 4 });
		await adjustStock({ itemId: 'strings', delta: 10 });
		expect(open()).toHaveLength(0);
		expect(tasks()[0].resolution_notes).toMatch(/reorder point/);
	});

	it('close when an order is placed, and open again when it is cancelled', async () => {
		await consumeStock({ itemId: 'strings', quantity: 4 });
		const orderId = await createOrder({
			placedAt: new Date(),
			lines: [{ itemId: 'strings', quantityOrdered: 10 }]
		});
		expect(open()).toHaveLength(0);
		expect(tasks()[0].resolution_notes).toMatch(/purchase order/);

		await cancelOrder(orderId);
		expect(open()).toHaveLength(1);
		expect(tasks()).toHaveLength(2);
	});

	it('the sweep opens tasks for items already low, and is idempotent', async () => {
		sqlite.exec(`
			insert into inventory_item (id, name, category_id, kind, reorder_point)
				values ('picks', 'Picks', 'c', 'bulk', 10);
		`);
		const first = await syncRestockTasks();
		expect(first).toEqual({ opened: 1, closed: 0 });
		expect(await syncRestockTasks()).toEqual({ opened: 0, closed: 0 });
		expect(open().map((t) => t.title)).toEqual(['Restock Picks']);
	});

	it('a hand close leaves the item to open a new task on its next change', async () => {
		await consumeStock({ itemId: 'strings', quantity: 4 });
		sqlite.exec(`update work_order set resolved_at = unixepoch() where source = 'restock'`);
		await consumeStock({ itemId: 'strings', quantity: 1 });
		expect(open()).toHaveLength(1);
	});
});
