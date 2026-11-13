import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `work_order_link` (#2622) on a real SQLite with foreign keys on, as D1 has
 * them: the one-target CHECK, the cascades, and the helpers every reader of a
 * task's unit or booking goes through.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

// D1's `batch` is typed for a non-empty tuple; the helpers return arrays.
const batch = (stmts: unknown[]) =>
	testDb.batch(stmts as unknown as Parameters<typeof testDb.batch>[0]);

const { linkInserts, linkInsertIfTaskExists, linkedAssetIds, linkedIdSql, linkedTo, replaceLink } =
	await import('./work-order-link');
const { workOrder } = await import('#lib/server/db/schema/volunteer.js');

const links = () =>
	sqlite
		.prepare(`select work_order_id, asset_id, reservation_id from work_order_link order by rowid`)
		.all();

beforeEach(() => {
	// The fixture rows name parents (a category, a booker) this spec does not need.
	sqlite.pragma('foreign_keys = OFF');
	for (const t of ['work_order_link', 'work_order', 'inventory_asset', 'inventory_item']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into inventory_item (id, name, category_id, kind) values ('item', 'Bassman', 'cat', 'asset');
		insert into inventory_asset (id, item_id, condition, status) values
			('amp', 'item', 'good', 'in_service'),
			('cab', 'item', 'good', 'in_service');
		insert into work_order (id, title) values ('retube', 'Retube'), ('sweep', 'Sweep');
	`);
	sqlite.pragma('foreign_keys = ON');
});

describe('the table', () => {
	it('takes exactly one target per row', () => {
		expect(() =>
			sqlite.exec(`insert into work_order_link (id, work_order_id) values ('none', 'retube')`)
		).toThrow(/CHECK/);
		expect(() =>
			sqlite.exec(
				`insert into work_order_link (id, work_order_id, asset_id, organization_id)
				 values ('two', 'retube', 'amp', 'org')`
			)
		).toThrow(/CHECK|FOREIGN/);
	});

	it('goes with its task and with its target', async () => {
		await batch([
			...linkInserts('retube', { assetId: 'amp' }),
			...linkInserts('sweep', { assetId: 'cab' })
		]);
		sqlite.exec(`delete from work_order where id = 'retube'`);
		sqlite.exec(`delete from inventory_asset where id = 'cab'`);
		expect(links()).toEqual([]);
		// The task outlives the record it was about.
		expect(sqlite.prepare(`select id from work_order`).all()).toEqual([{ id: 'sweep' }]);
	});

	it('links a task to a record once', async () => {
		await batch(linkInserts('retube', { assetId: 'amp' }));
		await expect(batch(linkInserts('retube', { assetId: 'amp' }))).rejects.toThrow(/UNIQUE/);
	});
});

describe('helpers', () => {
	it('replaces one kind of link and leaves the others', async () => {
		sqlite.pragma('foreign_keys = OFF');
		sqlite.exec(`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			values ('res', 'user', 'u', 'u', 'confirmed', 1, 2)`);
		sqlite.pragma('foreign_keys = ON');
		await batch(linkInserts('retube', { assetId: 'amp', reservationId: 'res' }));

		await batch(replaceLink('retube', 'assetId', 'cab'));
		expect(await linkedAssetIds(['retube'])).toEqual(new Map([['retube', 'cab']]));

		await batch(replaceLink('retube', 'assetId', null));
		expect(links()).toEqual([{ work_order_id: 'retube', asset_id: null, reservation_id: 'res' }]);
	});

	it('skips a conditional link when its task was never written', async () => {
		await batch([
			linkInsertIfTaskExists('missing', 'assetId', 'amp'),
			linkInsertIfTaskExists('retube', 'assetId', 'amp')
		]);
		expect(links()).toEqual([{ work_order_id: 'retube', asset_id: 'amp', reservation_id: null }]);
	});

	it("reads a task's first unit as a column, and finds tasks by unit", async () => {
		await batch(linkInserts('retube', { assetId: 'amp' }));
		const rows = await testDb
			.select({ id: workOrder.id, assetId: linkedIdSql('assetId') })
			.from(workOrder)
			.orderBy(workOrder.id);
		expect(rows).toEqual([
			{ id: 'retube', assetId: 'amp' },
			{ id: 'sweep', assetId: null }
		]);
		const about = await testDb
			.select({ id: workOrder.id })
			.from(workOrder)
			.where(linkedTo('assetId', 'amp'));
		expect(about).toEqual([{ id: 'retube' }]);
	});
});
