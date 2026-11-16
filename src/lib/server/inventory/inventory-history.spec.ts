import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The item and unit history feeds against a real SQLite: the actor is a join, the page is limit + 1. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const jobsForAsset = vi.fn(async (_assetId: string) => [] as unknown[]);
vi.mock('#lib/server/contractor/contractor-job-service.js', () => ({
	jobsForAsset: (id: string) => jobsForAsset(id)
}));

const { listMovementFeed, listAssetHistory, listLoanFeed } = await import('./inventory-history');

function movement(id: string, at: number, over: Record<string, unknown> = {}) {
	const row: Record<string, unknown> = {
		id,
		item_id: 'item-1',
		asset_id: null,
		quantity: 1,
		reason: 'receive',
		occurred_at: at,
		created_at: at,
		...over
	};
	const keys = Object.keys(row);
	sqlite
		.prepare(
			`insert into stock_movement (${keys.join(', ')}) values (${keys.map(() => '?').join(', ')})`
		)
		.run(...keys.map((k) => row[k]));
}

beforeEach(() => {
	for (const t of ['stock_movement', 'user']) sqlite.exec(`delete from ${t}`);
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('u-1', 'Sam', 'sam@x.test', 0)`
	);
	jobsForAsset.mockClear();
});

describe('listMovementFeed', () => {
	it("reads only the scope's rows, newest first, with who moved them", async () => {
		movement('m-1', 100, { actor_id: 'u-1' });
		movement('m-2', 200, { quantity: -2, reason: 'consume' });
		movement('m-3', 300, { item_id: 'item-2' });

		const page = await listMovementFeed({ itemId: 'item-1' });

		expect(page.items.map((i) => [i.id, i.actorId, i.quantity])).toEqual([
			['move:m-2', null, -2],
			['move:m-1', 'u-1', 1]
		]);
		expect(page.items[1].actorName).toBe('Sam');
		expect(page.hasMore).toBe(false);
	});

	it('lists same-second movements latest-written first, not by their random id', async () => {
		for (const id of ['zz-first', 'aa-second', 'mm-third']) movement(id, 500);
		const page = await listMovementFeed({ itemId: 'item-1' });
		expect(page.items.map((i) => i.id)).toEqual([
			'move:mm-third',
			'move:aa-second',
			'move:zz-first'
		]);
	});

	it('pages past the limit instead of capping silently', async () => {
		for (let i = 0; i < 3; i++) movement(`m-${i}`, i);
		const page = await listMovementFeed({ itemId: 'item-1' }, { limit: 2 });
		expect(page.items).toHaveLength(2);
		expect(page.hasMore).toBe(true);
	});
});

describe('listLoanFeed', () => {
	function loan(id: string, at: number) {
		sqlite
			.prepare(
				`insert into inventory_loan (id, item_id, user_id, requested_pickup_date, status, created_at, updated_at)
				 values (?, 'item-1', 'u-1', ?, 'requested', ?, ?)`
			)
			.run(id, at, at, at);
	}

	beforeEach(() => sqlite.exec('delete from inventory_loan'));

	it('lists same-second loans latest-written first, and pages with limit + 1', async () => {
		for (const id of ['zz-first', 'aa-second', 'mm-third']) loan(id, 500);

		const all = await listLoanFeed('item-1');
		expect(all.items.map((i) => i.loanId)).toEqual(['mm-third', 'aa-second', 'zz-first']);
		expect(all.hasMore).toBe(false);

		const first = await listLoanFeed('item-1', { limit: 2 });
		expect(first.items.map((i) => i.loanId)).toEqual(['mm-third', 'aa-second']);
		expect(first.hasMore).toBe(true);
	});
});

describe('listAssetHistory', () => {
	const job = (id: string, completedAt: Date | null) => ({
		job: {
			id,
			workOrderId: `wo-${id}`,
			projectId: null,
			title: `Job ${id}`,
			status: 'completed',
			costCents: 1800,
			completedAt,
			scheduledFor: null,
			createdAt: new Date(0)
		},
		contractor: { id: 'c-1', name: 'Fixit' }
	});

	it("merges the unit's movements and service jobs by date", async () => {
		movement('m-1', 100, { asset_id: 'a-1' });
		movement('m-2', 300, { asset_id: 'a-1' });
		jobsForAsset.mockResolvedValue([job('j-1', new Date(200_000))]);

		const page = await listAssetHistory('a-1', { withService: true });

		expect(page.items.map((i) => i.id)).toEqual(['move:m-2', 'job:j-1', 'move:m-1']);
	});

	it('leaves service out, unread, without contractor.read', async () => {
		movement('m-1', 100, { asset_id: 'a-1' });
		const page = await listAssetHistory('a-1', { withService: false });
		expect(page.items.map((i) => i.kind)).toEqual(['movement']);
		expect(jobsForAsset).not.toHaveBeenCalled();
	});
});
