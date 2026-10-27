import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Completing an engagement ticks its work order; ticking the work order does not
 * complete the engagement. Both directions cross two services and two tables,
 * so they run against a real SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// D1 runs a batch as one transaction; better-sqlite3's drizzle has no `batch`, so this is it.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			sqlite.exec('begin');
			try {
				const out = [];
				for (const s of stmts) out.push(await s);
				sqlite.exec('commit');
				return out;
			} catch (e) {
				sqlite.exec('rollback');
				throw e;
			}
		}
	})
}));

const { completeJob, recordInvoice } = await import('./contractor-job-service');
const { resolveWorkOrder } = await import('$lib/server/volunteer/work-order-service');
// `resolveWorkOrder` imports these lazily; loading them here keeps that cost
// out of the first test's 5s budget on a cold cache.
await import('$lib/server/inventory/work-request-service');
await import('$lib/server/volunteer/orientation-service');

const row = (sql: string) => sqlite.prepare(sql).get() as Record<string, unknown>;

beforeEach(() => {
	sqlite.exec('drop trigger if exists work_order_write_fails');
	for (const table of [
		'financial_entry',
		'contractor_job',
		'work_order',
		'contractor',
		'inventory_asset',
		'inventory_item'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(
		`insert into contractor (id, name, trade) values ('c-1', 'Benton Electric', 'electrical')`
	);
	sqlite.exec(`insert into work_order (id, title) values ('wo-1', 'Add a dedicated circuit')`);
	sqlite.exec(
		`insert into contractor_job (id, contractor_id, work_order_id, status)
			values ('job-1', 'c-1', 'wo-1', 'booked')`
	);
});

describe('an engagement and its work order', () => {
	it('completing the engagement resolves the work order', async () => {
		await completeJob('job-1', { costCents: 94_500, actorId: 'staff-1' });

		expect(row(`select status, completed_at from contractor_job where id = 'job-1'`)).toMatchObject(
			{ status: 'completed', completed_at: expect.any(Number) }
		);
		expect(
			row(`select resolved_at, resolved_by_user_id from work_order where id = 'wo-1'`)
		).toMatchObject({ resolved_at: expect.any(Number), resolved_by_user_id: 'staff-1' });
	});

	it('keeps the resolution staff already recorded', async () => {
		sqlite.exec(`update work_order set resolved_at = 1000, resolved_by_user_id = 'staff-0'`);

		await completeJob('job-1', { actorId: 'staff-1' });

		expect(row(`select resolved_at, resolved_by_user_id from work_order`)).toEqual({
			resolved_at: 1000,
			resolved_by_user_id: 'staff-0'
		});
	});

	it('resolving the work order leaves the engagement where it was', async () => {
		await resolveWorkOrder('wo-1', { resolvedByUserId: 'staff-1' });

		expect(row(`select status, completed_at from contractor_job where id = 'job-1'`)).toEqual({
			status: 'booked',
			completed_at: null
		});
	});
});

describe('the ledger entry for a paid job', () => {
	const spent = () =>
		sqlite
			.prepare(
				`select amount_cents from financial_entry where kind = 'spent' and subject_id = 'job-1'`
			)
			.all();

	it('is written when the cost is known at completion', async () => {
		await completeJob('job-1', { costCents: 12_000, actorId: 'staff-1' });

		expect(spent()).toEqual([{ amount_cents: -12_000 }]);
	});

	it('is written when the invoice arrives after completion (#1894)', async () => {
		await completeJob('job-1', { actorId: 'staff-1' });
		await recordInvoice('job-1', { costCents: 12_000, invoiceRef: 'INV-7' });

		expect(spent()).toEqual([{ amount_cents: -12_000 }]);
	});
});

describe('completing an engagement is one write (#1914)', () => {
	beforeEach(() => {
		sqlite.exec(
			`insert into inventory_item (id, name, category_id, kind) values ('item-1', 'Bassman', 'cat-1', 'asset')`
		);
		sqlite.exec(
			`insert into inventory_asset (id, item_id, condition, status) values ('asset-1', 'item-1', 'fair', 'maintenance')`
		);
		sqlite.exec(`update work_order set asset_id = 'asset-1'`);
		// The last of the writes fails, as a dropped connection would fail it.
		sqlite.exec(`create trigger work_order_write_fails before update on work_order
			begin select raise(abort, 'D1_ERROR: network connection lost'); end`);
	});

	it('leaves nothing written when the work order cannot be resolved', async () => {
		await expect(completeJob('job-1', { costCents: 12_000, actorId: 'staff-1' })).rejects.toThrow(
			'network connection lost'
		);

		expect({
			engagement: row(`select status from contractor_job where id = 'job-1'`).status,
			ledgerEntries: row(`select count(*) as n from financial_entry`).n,
			asset: row(`select status from inventory_asset where id = 'asset-1'`).status
		}).toEqual({ engagement: 'booked', ledgerEntries: 0, asset: 'maintenance' });
	});
});
