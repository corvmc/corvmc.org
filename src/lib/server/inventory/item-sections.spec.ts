import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The item page's cross-record sections, against a real SQLite: each is a filtered join. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { itemSections, openOrderLinesForItem, openProblemsForItem, sourcesForItem } =
	await import('./item-sections');

const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeEach(() => {
	for (const t of [
		'work_request',
		'purchase_order_line',
		'purchase_order',
		'acquisition_line',
		'inventory_asset',
		'acquisition',
		'inventory_item',
		'equipment_category',
		'user'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.exec(`
		INSERT INTO equipment_category (id, name, display_order, pricing_tier)
		VALUES ('cat', 'Gear', 0, 'major');
		INSERT INTO inventory_item (id, name, category_id, kind, unit_of_measure, is_loanable)
		VALUES ('amp', 'Blues Deluxe', 'cat', 'serialized', 'each', 1),
		       ('other', 'Strings', 'cat', 'bulk', 'pack', 0);
		INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		VALUES ('donor', 'Dana Donor', 'dana@example.com', 0, 0, 0);
	`);
});

describe('openOrderLinesForItem', () => {
	beforeEach(() => {
		sqlite.exec(`
			INSERT INTO purchase_order (id, status, supplier_name, expected_at) VALUES
				('po-late', 'placed', 'Sweetwater', ${secs('2026-11-20')}),
				('po-soon', 'placed', 'Guitar Center', ${secs('2026-11-02')}),
				('po-undated', 'placed', NULL, NULL),
				('po-draft', 'draft', 'Sweetwater', NULL),
				('po-cancelled', 'cancelled', 'Sweetwater', NULL),
				('po-full', 'placed', 'Sweetwater', NULL);
			INSERT INTO purchase_order_line (id, order_id, item_id, quantity_ordered, quantity_received) VALUES
				('l1', 'po-late', 'amp', 4, 1),
				('l2', 'po-soon', 'amp', 2, 0),
				('l3', 'po-undated', 'amp', 1, 0),
				('l4', 'po-draft', 'amp', 9, 0),
				('l5', 'po-cancelled', 'amp', 9, 0),
				('l6', 'po-full', 'amp', 3, 3),
				('l7', 'po-soon', 'other', 5, 0);
		`);
	});

	it('lists what is still owed on placed orders, soonest first, undated last', async () => {
		const rows = await openOrderLinesForItem('amp');
		expect(rows.map((r) => [r.orderId, r.outstanding])).toEqual([
			['po-soon', 2],
			['po-late', 3],
			['po-undated', 1]
		]);
	});
});

describe('openProblemsForItem', () => {
	it("lists pending reports on this item's units only", async () => {
		sqlite.exec(`
			INSERT INTO inventory_asset (id, item_id, condition, asset_tag) VALUES
				('a1', 'amp', 'good', 'CMC-1'),
				('a2', 'other', 'good', NULL);
			INSERT INTO work_request (id, asset_id, note, status, work_order_id, created_at) VALUES
				('open', 'a1', 'Crackles', 'pending', NULL, 2),
				('sent', 'a1', 'Hums', 'pending', 'wo-1', 3),
				('fixed', 'a1', 'Dead', 'resolved', 'wo-0', 1),
				('elsewhere', 'a2', 'Frayed', 'pending', NULL, 4);
			INSERT INTO work_request (id, location, note, status) VALUES
				('building', 'Bathroom', 'Running toilet', 'pending');
		`);
		const rows = await openProblemsForItem('amp');
		expect(rows.map((r) => [r.id, r.inWorkOrder, r.assetTag])).toEqual([
			['sent', true, 'CMC-1'],
			['open', false, 'CMC-1']
		]);
	});
});

describe('itemSections', () => {
	it('withholds reports, which name their reporter, from a viewer who cannot triage', async () => {
		sqlite.exec(`
			INSERT INTO inventory_asset (id, item_id, condition) VALUES ('a1', 'amp', 'good');
			INSERT INTO work_request (id, asset_id, note, status) VALUES ('open', 'a1', 'Crackles', 'pending');
		`);
		expect((await itemSections('amp', { canTriage: false })).problems).toBeNull();
		expect((await itemSections('amp', { canTriage: true })).problems).toHaveLength(1);
	});
});

describe('sourcesForItem', () => {
	it("names a member donor, else the typed source, and skips other items' lines", async () => {
		sqlite.exec(`
			INSERT INTO acquisition (id, kind, occurred_at, source_name, donor_user_id) VALUES
				('bought', 'purchase', ${secs('2026-03-01')}, 'Sweetwater', NULL),
				('given', 'donation', ${secs('2026-05-01')}, 'ignored', 'donor'),
				('unrelated', 'purchase', ${secs('2026-06-01')}, 'Shop', NULL);
			INSERT INTO acquisition_line (id, acquisition_id, item_id, quantity, unit_value_cents) VALUES
				('x1', 'bought', 'amp', 1, 70000),
				('x2', 'given', 'amp', 2, NULL),
				('x3', 'unrelated', 'other', 10, 500);
		`);
		const rows = await sourcesForItem('amp');
		expect(rows.map((r) => [r.acquisitionId, r.source, r.quantity])).toEqual([
			['given', 'Dana Donor', 2],
			['bought', 'Sweetwater', 1]
		]);
	});
});
