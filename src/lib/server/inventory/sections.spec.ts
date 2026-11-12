import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inventorySections } from '#lib/config.js';

/**
 * Gear and Supplies against a real SQLite: the list filter is a `WHERE`, which a
 * mocked `db` agrees with whether or not it is right. Every kind × loanable pair
 * is seeded, so the spec also pins that the SQL term and `sectionOf` agree.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listItems } = await import('./item-service');
const { listLowStock } = await import('./stock-service');
const { sectionOf } = await import('./sections');

const items = [
	// The room's PA: tracked unit by unit, never lent out.
	{ id: 'pa', kind: 'serialized', loanable: false, gear: true },
	{ id: 'amp', kind: 'serialized', loanable: true, gear: true },
	{ id: 'cables', kind: 'bulk', loanable: true, gear: true },
	{ id: 'batteries', kind: 'bulk', loanable: false, gear: false }
] as const;

beforeEach(() => {
	for (const t of ['stock_movement', 'inventory_item', 'equipment_category']) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.exec(`
		INSERT INTO equipment_category (id, name, display_order, pricing_tier)
		VALUES ('cat', 'Everything', 0, 'accessory');
	`);
	const insert = sqlite.prepare(
		`INSERT INTO inventory_item (id, name, category_id, kind, unit_of_measure, is_loanable, reorder_point)
		 VALUES (?, ?, 'cat', ?, 'each', ?, ?)`
	);
	// Every bulk item sits at a reorder point of 1 with nothing on hand, so restock lists it.
	for (const i of items)
		insert.run(i.id, i.id, i.kind, i.loanable ? 1 : 0, i.kind === 'bulk' ? 1 : null);
});

const expected = (section: string) =>
	items
		.filter((i) => i.gear === (section === 'gear'))
		.map((i) => i.id)
		.sort();

describe('inventory sections', () => {
	it('files a serialized item that is not lent out under Gear', () => {
		expect(sectionOf({ kind: 'serialized', isLoanable: false })).toBe('gear');
	});

	it('files a bulk item that is not lent out under Supplies', () => {
		expect(sectionOf({ kind: 'bulk', isLoanable: false })).toBe('supplies');
	});

	it.each(inventorySections)('lists exactly the %s items, each labelled so', async (section) => {
		const { rows } = await listItems({ section });
		expect(rows.map((r) => r.id).sort()).toEqual(expected(section));
		expect(rows.every((r) => r.section === section)).toBe(true);
	});

	it.each(inventorySections)('restocks only the %s items', async (section) => {
		const rows = await listLowStock({ section });
		const want = expected(section).filter((id) => items.find((i) => i.id === id)?.kind === 'bulk');
		expect(rows.map((r) => r.id).sort()).toEqual(want);
	});

	it('splits every item into exactly one section', async () => {
		const [gear, supplies, all] = await Promise.all([
			listItems({ section: 'gear' }),
			listItems({ section: 'supplies' }),
			listItems()
		]);
		expect(gear.rows.length + supplies.rows.length).toBe(all.rows.length);
	});
});
