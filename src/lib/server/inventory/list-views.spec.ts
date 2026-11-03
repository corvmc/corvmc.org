import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The Inventory list's cross-item views, against a real SQLite: each is a predicate (#2021). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; `createOrder` needs one, in order.
vi.mock('#lib/server/db/index.js', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

const { listItems } = await import('./item-service');
const { createOrder } = await import('./order-service');

const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = new Date('2026-11-02T12:00:00Z');

const idsIn = async (view: NonNullable<Parameters<typeof listItems>[0]>['view']) =>
	(await listItems({ view, now: NOW })).rows.map((r) => r.id).sort();

beforeEach(() => {
	for (const t of [
		'work_request',
		'inventory_loan',
		'purchase_order_line',
		'purchase_order',
		'inventory_asset',
		'inventory_item',
		'equipment_category',
		'user'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.exec(`
		INSERT INTO equipment_category (id, name, display_order, pricing_tier)
		VALUES ('cat', 'Gear', 0, 'major');
		INSERT INTO inventory_item (id, name, category_id, kind, unit_of_measure, is_loanable) VALUES
			('amp', 'Amp', 'cat', 'serialized', 'each', 1),
			('mic', 'Mic', 'cat', 'serialized', 'each', 1),
			('strings', 'Strings', 'cat', 'bulk', 'pack', 0),
			('picks', 'Picks', 'cat', 'bulk', 'pack', 0),
			('cables', 'Cables', 'cat', 'bulk', 'each', 0);
		INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		VALUES ('m', 'Member', 'm@example.com', 0, 0, 0);
		INSERT INTO inventory_asset (id, item_id, condition) VALUES
			('amp-1', 'amp', 'good'), ('mic-1', 'mic', 'good');
		INSERT INTO purchase_order (id, status, expected_at) VALUES
			('po-late', 'placed', ${secs('2026-10-20')}),
			('po-soon', 'placed', ${secs('2026-11-20')}),
			('po-draft', 'draft', ${secs('2026-10-01')}),
			('po-full', 'placed', ${secs('2026-10-01')});
		INSERT INTO purchase_order_line (id, order_id, item_id, quantity_ordered, quantity_received) VALUES
			('l1', 'po-late', 'strings', 10, 4),
			('l2', 'po-soon', 'picks', 5, 0),
			('l3', 'po-draft', 'cables', 5, 0),
			('l4', 'po-full', 'cables', 3, 3);
		INSERT INTO inventory_loan (id, item_id, user_id, requested_pickup_date, due_date, status, returned_at) VALUES
			('loan-over', 'amp', 'm', 0, ${secs('2026-10-30')}, 'checked_out', NULL),
			('loan-out', 'mic', 'm', 0, ${secs('2026-11-09')}, 'checked_out', NULL),
			('loan-done', 'strings', 'm', 0, ${secs('2026-10-01')}, 'returned', ${secs('2026-10-02')}),
			('loan-asked', 'picks', 'm', 0, NULL, 'requested', NULL);
		INSERT INTO work_request (id, asset_id, note, status) VALUES
			('wr-open', 'mic-1', 'Crackles', 'pending'),
			('wr-done', 'amp-1', 'Hum', 'resolved');
	`);
});

describe('listItems views', () => {
	it('on-order keeps placed lines with something still owed', async () => {
		expect(await idsIn('on-order')).toEqual(['picks', 'strings']);
	});

	it('late keeps only those past their expected date', async () => {
		expect(await idsIn('late')).toEqual(['strings']);
	});

	it('on-loan keeps checked-out items, and overdue the ones past due', async () => {
		expect(await idsIn('on-loan')).toEqual(['amp', 'mic']);
		expect(await idsIn('overdue')).toEqual(['amp']);
	});

	it('problems keeps items with a pending report on a unit', async () => {
		expect(await idsIn('problems')).toEqual(['mic']);
	});

	it('no view keeps everything', async () => {
		expect((await listItems({ now: NOW })).rows).toHaveLength(5);
	});
});

describe('Mark as ordered', () => {
	it('writes a placed order, so the item is on order at once', async () => {
		const orderId = await createOrder({
			placedAt: NOW,
			expectedAt: new Date('2026-11-10'),
			lines: [{ itemId: 'cables', quantityOrdered: 2 }]
		});
		const [row] = sqlite
			.prepare('SELECT status, placed_at FROM purchase_order WHERE id = ?')
			.all(orderId) as { status: string; placed_at: number }[];
		expect(row.status).toBe('placed');
		expect(row.placed_at).toBe(secs(NOW.toISOString()));
		expect(await idsIn('on-order')).toEqual(['cables', 'picks', 'strings']);
	});
});
