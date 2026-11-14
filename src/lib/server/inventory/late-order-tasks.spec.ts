import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A late purchase order opens one task, closed when received or cancelled (#2757). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({ config: async () => '' }));

const { createOrder, cancelOrder, closeOrderShort, syncLateOrderTasks } =
	await import('./order-service');

const DAY = 86_400_000;
const tasks = () =>
	sqlite.prepare(`select title, resolved_at from work_order where source = 'late_order'`).all() as {
		title: string;
		resolved_at: number | null;
	}[];

beforeEach(() => {
	sqlite.exec(`
		delete from work_order; delete from purchase_order_line; delete from purchase_order;
		delete from stock_movement; delete from inventory_item; delete from equipment_category;
		insert into equipment_category (id, name, pricing_tier) values ('c', 'Strings', 'minor');
		insert into inventory_item (id, name, category_id, kind) values ('strings', 'Strings', 'c', 'bulk');
	`);
});

const order = (expectedInDays: number) =>
	createOrder({
		placedAt: new Date(Date.now() - 10 * DAY),
		expectedAt: new Date(Date.now() + expectedInDays * DAY),
		reference: 'SW-1',
		lines: [{ itemId: 'strings', quantityOrdered: 10 }]
	});

describe('late order tasks', () => {
	it('open once the expected date passes, once', async () => {
		await order(2);
		expect(tasks()).toEqual([]);
		const later = new Date(Date.now() + 3 * DAY);
		await syncLateOrderTasks(later);
		await syncLateOrderTasks(later);
		expect(tasks()).toEqual([{ title: 'Chase late order (SW-1)', resolved_at: null }]);
	});

	it('close when the order is cancelled', async () => {
		const id = await order(-1);
		expect(tasks()).toHaveLength(1);
		await cancelOrder(id);
		expect(tasks()[0].resolved_at).not.toBeNull();
	});

	it('close when the order is closed short', async () => {
		const id = await order(-1);
		await closeOrderShort(id);
		expect(tasks()[0].resolved_at).not.toBeNull();
	});
});
