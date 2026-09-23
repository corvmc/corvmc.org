import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * Triage: the staff half of an equipment report. A report is either dismissed or
 * sent to a work order, and sending one sweeps every other untriaged report on
 * the same unit with it — three people noticing one crackle is one repair.
 */

let selectResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let whereArgs: unknown[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			if (prop === 'where') {
				return (arg: unknown) => {
					whereArgs.push(arg);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

const nextSelect = () => (selectResults.length > 0 ? selectResults.shift()! : []);
const dialect = new SQLiteSyncDialect();
const renderWhere = (index: number) => dialect.sqlToQuery(whereArgs[index] as SQL);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(nextSelect)),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => []);
			}
		}))
	}
}));

vi.mock('./asset-service', () => ({
	setAssetStatus: vi.fn(),
	AssetNotFoundError: class extends Error {}
}));

vi.mock('../volunteer/work-order-service', () => ({
	createWorkOrder: vi.fn().mockResolvedValue({ id: 'wo-new' })
}));

const { listWorkRequests, sendToWorkOrder, WorkRequestNotFoundError, WorkRequestTriageError } =
	await import('./work-request-service');
const { createWorkOrder } = await import('../volunteer/work-order-service');

const REQUEST = {
	id: 'wr-1',
	assetId: 'as-1',
	status: 'pending',
	note: 'Crackles',
	workOrderId: null
};

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	updateValues = [];
	whereArgs = [];
});

describe('listWorkRequests', () => {
	it('keeps the untriaged queue to pending reports no work order has taken', async () => {
		selectResults = [[], [{ count: 0 }]];

		await listWorkRequests({ stage: 'untriaged' }, { page: 1, pageSize: 25 });

		const { sql, params } = renderWhere(0);
		expect(sql).toContain('"work_request"."status" = ?');
		expect(sql).toContain('"work_request"."work_order_id" is null');
		expect(params).toContain('pending');
	});

	it('shows reports already sent to a work order separately', async () => {
		selectResults = [[], [{ count: 0 }]];

		await listWorkRequests({ stage: 'in_work_order' }, { page: 1, pageSize: 25 });

		expect(renderWhere(0).sql).toContain('"work_request"."work_order_id" is not null');
	});

	it('searches the note and the item name', async () => {
		selectResults = [[], [{ count: 0 }]];

		await listWorkRequests({ search: 'amp' }, { page: 1, pageSize: 25 });

		const { sql, params } = renderWhere(0);
		expect(sql).toContain('"work_request"."note" like ?');
		expect(sql).toContain('"inventory_item"."name" like ?');
		expect(params).toContain('%amp%');
	});
});

describe('sendToWorkOrder', () => {
	it('attaches the report and every other untriaged report on the unit to an open work order', async () => {
		selectResults = [
			[REQUEST],
			[{ id: 'wo-1', assetId: 'as-1', resolvedAt: null, cancelledAt: null }],
			[{ id: 'wr-1' }, { id: 'wr-2' }]
		];

		const result = await sendToWorkOrder('wr-1', { workOrderId: 'wo-1' }, 'staff-1');

		expect(result).toEqual({ workOrderId: 'wo-1', attached: 2 });
		expect(updateValues[0]).toMatchObject({ workOrderId: 'wo-1' });
	});

	it('raises a new work order against the unit when asked', async () => {
		selectResults = [[REQUEST], [{ id: 'wr-1' }]];

		const result = await sendToWorkOrder(
			'wr-1',
			{ newOrder: { volunteerRoleId: 'role-1' } },
			'staff-1'
		);

		expect(createWorkOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				volunteerRoleId: 'role-1',
				assetId: 'as-1',
				notes: 'Crackles',
				createdByUserId: 'staff-1'
			})
		);
		expect(result.workOrderId).toBe('wo-new');
	});

	it('refuses a work order for a different unit', async () => {
		selectResults = [
			[REQUEST],
			[{ id: 'wo-1', assetId: 'as-other', resolvedAt: null, cancelledAt: null }]
		];

		await expect(sendToWorkOrder('wr-1', { workOrderId: 'wo-1' }, 'staff-1')).rejects.toThrow(
			WorkRequestTriageError
		);
	});

	it('refuses a work order that is already closed', async () => {
		selectResults = [
			[REQUEST],
			[{ id: 'wo-1', assetId: 'as-1', resolvedAt: new Date(), cancelledAt: null }]
		];

		await expect(sendToWorkOrder('wr-1', { workOrderId: 'wo-1' }, 'staff-1')).rejects.toThrow(
			WorkRequestTriageError
		);
	});

	it('refuses a report that was already dismissed', async () => {
		selectResults = [[{ ...REQUEST, status: 'dismissed' }]];

		await expect(sendToWorkOrder('wr-1', { workOrderId: 'wo-1' }, 'staff-1')).rejects.toThrow(
			WorkRequestTriageError
		);
	});

	it('throws for a report that does not exist', async () => {
		selectResults = [[]];

		await expect(sendToWorkOrder('nope', { workOrderId: 'wo-1' }, 'staff-1')).rejects.toThrow(
			WorkRequestNotFoundError
		);
	});
});
