import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A unit's own ledger sum, against a real SQLite: 1 in service, 0 once retired or lost. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));
vi.mock('$lib/server/audit/audit-service', () => ({ recordAuditEntry: vi.fn() }));

const { setAssetStatus, settleTerminalUnit, reopenAsset } = await import('./asset-service');

let seq = 0;
function movement(assetId: string, quantity: number, reason: string) {
	seq++;
	sqlite
		.prepare(
			`insert into stock_movement (id, item_id, asset_id, quantity, reason, occurred_at, created_at)
			 values (?, 'item-1', ?, ?, ?, ?, ?)`
		)
		.run(`mv-${seq}`, assetId, quantity, reason, seq, seq);
}

function unit(id: string, status: string) {
	sqlite
		.prepare(
			`insert into inventory_asset (id, item_id, condition, status) values (?, 'item-1', 'good', ?)`
		)
		.run(id, status);
	movement(id, 1, 'receive');
}

function held(assetId: string) {
	const row = sqlite
		.prepare(`select coalesce(sum(quantity), 0) as total from stock_movement where asset_id = ?`)
		.get(assetId) as { total: number };
	return row.total;
}

beforeEach(() => {
	for (const t of ['stock_movement', 'inventory_asset']) sqlite.exec(`delete from ${t}`);
});

describe('retiring or losing a unit', () => {
	it('takes an in-service unit off the ledger once', async () => {
		unit('a-1', 'in_service');
		await setAssetStatus('a-1', 'retired');
		expect(held('a-1')).toBe(0);
	});

	it('takes nothing more off a unit already in the shop', async () => {
		unit('a-1', 'in_service');
		await setAssetStatus('a-1', 'maintenance');
		await setAssetStatus('a-1', 'retired');
		expect(held('a-1')).toBe(0);
	});

	it('takes nothing more off a unit out on loan', async () => {
		unit('a-1', 'on_loan');
		movement('a-1', -1, 'loan_out');
		await setAssetStatus('a-1', 'lost');
		expect(held('a-1')).toBe(0);
	});

	it('takes a lost unit back off when its loan is returned', async () => {
		unit('a-1', 'on_loan');
		movement('a-1', -1, 'loan_out');
		await setAssetStatus('a-1', 'lost');
		movement('a-1', 1, 'loan_return');
		await settleTerminalUnit('a-1', null);
		expect(held('a-1')).toBe(0);
	});

	it('reopens a unit retired from the shop to one on the ledger', async () => {
		unit('a-1', 'in_service');
		await setAssetStatus('a-1', 'maintenance');
		await setAssetStatus('a-1', 'retired');
		await reopenAsset('a-1', 'Repaired after all', 'u-1');
		expect(held('a-1')).toBe(1);
	});
});
