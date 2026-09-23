import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Closing the reports a work order answered, and telling the people who filed
 * them. The notice is the reason anybody bothers reporting a second time.
 */

let selectResults: unknown[][] = [];
let updateReturning: unknown[] = [];
const updateValues: Record<string, unknown>[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(() => (selectResults.length > 0 ? selectResults.shift()! : []))),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => updateReturning);
			}
		}))
	}
}));

vi.mock('./asset-service', () => ({
	setAssetStatus: vi.fn(),
	AssetNotFoundError: class extends Error {}
}));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit } }));

const { resolveFlagsForWorkOrder } = await import('./work-request-service');

const flag = (id: string, reportedByUserId: string | null) => ({
	id,
	assetId: 'as-1',
	workOrderId: 'wo-1',
	reportedByUserId,
	status: 'resolved'
});

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	updateReturning = [];
	updateValues.length = 0;
});

describe('resolveFlagsForWorkOrder', () => {
	it('tells each reporter once that the unit they reported was fixed', async () => {
		updateReturning = [flag('wr-1', 'u-1'), flag('wr-2', 'u-2'), flag('wr-3', 'u-1')];
		selectResults = [
			[{ name: 'Fender Twin', assetTag: 'AMP-3' }],
			[
				{ id: 'u-1', name: 'Ada', email: 'ada@test.com' },
				{ id: 'u-2', name: 'Bo', email: 'bo@test.com' }
			]
		];

		const reporters = await resolveFlagsForWorkOrder('wo-1', 'staff-1');

		expect(reporters).toEqual(['u-1', 'u-2']);
		expect(emit).toHaveBeenCalledTimes(2);
		expect(emit).toHaveBeenCalledWith('equipment.report_resolved', {
			workOrderId: 'wo-1',
			assetId: 'as-1',
			userId: 'u-1',
			userName: 'Ada',
			userEmail: 'ada@test.com',
			equipmentName: 'Fender Twin (AMP-3)'
		});
	});

	it('tells nobody when there was nothing open to close', async () => {
		updateReturning = [];

		await resolveFlagsForWorkOrder('wo-1', 'staff-1');

		expect(emit).not.toHaveBeenCalled();
	});

	it('skips a report whose reporter deleted their account', async () => {
		updateReturning = [flag('wr-1', null)];
		selectResults = [[{ name: 'Fender Twin', assetTag: null }]];

		expect(await resolveFlagsForWorkOrder('wo-1', 'staff-1')).toEqual([]);
		expect(emit).not.toHaveBeenCalled();
	});

	it('closes the reports even when a notice fails', async () => {
		updateReturning = [flag('wr-1', 'u-1')];
		selectResults = [
			[{ name: 'Fender Twin', assetTag: null }],
			[{ id: 'u-1', name: 'Ada', email: 'ada@test.com' }]
		];
		emit.mockRejectedValueOnce(new Error('postmark down'));

		await expect(resolveFlagsForWorkOrder('wo-1', 'staff-1')).resolves.toEqual(['u-1']);
		expect(updateValues[0]).toMatchObject({ status: 'resolved', resolvedByUserId: 'staff-1' });
	});
});
