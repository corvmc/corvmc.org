import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A building problem: a report with a place instead of a unit. It rides the same
 * triage queue and work orders as an equipment report, but has no unit to take
 * out of service and no "other reports on this unit" to sweep up with it.
 */

let selectResults: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(queue());
			return () => proxy;
		}
	});
	return proxy;
}

const nextSelect = () => (selectResults.length > 0 ? selectResults.shift()! : []);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(nextSelect)),
		selectDistinct: vi.fn(() => chain(nextSelect)),
		insert: vi.fn(() => ({
			values: (v: Record<string, unknown>) => {
				inserted.push(v);
				return { returning: () => Promise.resolve([{ id: 'wr-9', ...v }]) };
			}
		})),
		update: vi.fn(() => ({
			set: (v: Record<string, unknown>) => {
				updated.push(v);
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

const {
	reportBuildingProblem,
	listWorkRequests,
	getWorkRequestDetail,
	sendToWorkOrder,
	WorkRequestTriageError
} = await import('./work-request-service');
const { setAssetStatus } = await import('./asset-service');
const { createWorkOrder } = await import('../volunteer/work-order-service');

const BUILDING = {
	id: 'wr-9',
	assetId: null,
	location: 'Downstairs bathroom',
	status: 'pending',
	note: 'Toilet will not stop running',
	workOrderId: null
};

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	inserted.length = 0;
	updated.length = 0;
});

describe('reportBuildingProblem', () => {
	it('records the place and the note, with no unit to take out of service', async () => {
		await reportBuildingProblem({
			location: '  Downstairs bathroom ',
			note: 'Toilet will not stop running',
			reportedByUserId: 'u-1'
		});

		expect(inserted[0]).toMatchObject({
			assetId: null,
			location: 'Downstairs bathroom',
			note: 'Toilet will not stop running',
			reportedByUserId: 'u-1',
			blocksUse: false
		});
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a report that does not say where', async () => {
		await expect(
			reportBuildingProblem({ location: '   ', note: 'Broken', reportedByUserId: 'u-1' })
		).rejects.toThrow();
		expect(inserted).toHaveLength(0);
	});
});

describe('the queue with a building problem in it', () => {
	it('lists it by place, with no unit', async () => {
		selectResults = [
			[
				{
					id: 'wr-9',
					status: 'pending',
					workOrderId: null,
					note: 'Toilet will not stop running',
					blocksUse: false,
					createdAt: new Date(),
					assetId: null,
					assetTag: null,
					itemName: null,
					location: 'Downstairs bathroom',
					reportedByName: 'Ada'
				}
			],
			[{ count: 1 }]
		];

		const { rows } = await listWorkRequests({}, { page: 1, pageSize: 25 });

		expect(rows[0]).toMatchObject({ asset: null, location: 'Downstairs bathroom' });
	});

	it('offers only the open work orders other building reports already went to', async () => {
		selectResults = [
			[
				{
					request: BUILDING,
					asset: null,
					itemName: null,
					reporterName: 'Ada',
					reporterEmail: 'a@x'
				}
			],
			[{ id: 'wo-3', notes: 'Plumber', dueAt: null, startsAt: null, roleName: 'Repairs' }]
		];

		const detail = await getWorkRequestDetail('wr-9');

		expect(detail.asset).toBeNull();
		expect(detail.location).toBe('Downstairs bathroom');
		expect(detail.otherPending).toEqual([]);
		expect(detail.openWorkOrders.map((w) => w.id)).toEqual(['wo-3']);
	});
});

describe('sendToWorkOrder for a building problem', () => {
	it('raises a work order with no unit, and takes only this report with it', async () => {
		selectResults = [[BUILDING]];

		const result = await sendToWorkOrder(
			'wr-9',
			{ newOrder: { volunteerRoleId: 'role-1' } },
			'staff-1'
		);

		expect(createWorkOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				assetId: null,
				notes: 'Downstairs bathroom: Toilet will not stop running'
			})
		);
		expect(result).toEqual({ workOrderId: 'wo-new', attached: 1 });
	});

	it('refuses a work order that is for a unit', async () => {
		selectResults = [
			[BUILDING],
			[{ id: 'wo-1', assetId: 'as-1', resolvedAt: null, cancelledAt: null }]
		];

		await expect(sendToWorkOrder('wr-9', { workOrderId: 'wo-1' }, 'staff-1')).rejects.toThrow(
			WorkRequestTriageError
		);
	});
});
