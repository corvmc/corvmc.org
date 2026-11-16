import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A Form 8282 owed opens one task due with the form, closed by `resolveForm8282` (#2757). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({ config: async () => '' }));

const { setAssetStatus, resolveForm8282, syncForm8282Tasks } = await import('./asset-service');

const DAY = 86_400_000;
const tasks = () =>
	sqlite
		.prepare(
			`select w.title, w.due_at is not null dated, w.resolved_at, l.asset_id from work_order w
			 left join work_order_link l on l.work_order_id = w.id where w.source = 'form_8282'`
		)
		.all() as { title: string; dated: number; resolved_at: number | null; asset_id: string }[];

beforeEach(() => {
	const year = Math.floor((Date.now() - 365 * DAY) / 1000);
	sqlite.exec(`
		delete from work_order; delete from stock_movement; delete from inventory_asset;
		delete from acquisition; delete from inventory_item; delete from equipment_category;
		insert into equipment_category (id, name, pricing_tier) values ('amps', 'Amps', 'major');
		insert into inventory_item (id, name, category_id, kind) values ('item', 'Bass amp', 'amps', 'serialized');
		insert into acquisition (id, kind, occurred_at, acknowledged_at)
			values ('gift', 'donation', ${year}, ${year});
		insert into inventory_asset (id, item_id, asset_tag, condition, acquisition_id)
			values ('unit', 'item', 'A-7', 'good', 'gift');
	`);
});

describe('Form 8282 tasks', () => {
	it('open when a signed-for gift is retired inside three years, linked and dated', async () => {
		await setAssetStatus('unit', 'retired', { notes: 'Sold' });
		expect(tasks()).toEqual([
			{ title: 'File Form 8282 for Bass amp (A-7)', dated: 1, resolved_at: null, asset_id: 'unit' }
		]);
		await syncForm8282Tasks();
		expect(tasks()).toHaveLength(1);
	});

	it('close when the filing is recorded', async () => {
		await setAssetStatus('unit', 'retired', { notes: 'Sold' });
		await resolveForm8282('unit', 'Filed');
		expect(tasks()[0].resolved_at).not.toBeNull();
	});

	it('the sweep opens one for a disposal that predates the source', async () => {
		sqlite.exec(
			`update inventory_asset set status = 'retired', retired_at = unixepoch() where id = 'unit'`
		);
		expect(tasks()).toEqual([]);
		await syncForm8282Tasks();
		expect(tasks()).toHaveLength(1);
	});
});
