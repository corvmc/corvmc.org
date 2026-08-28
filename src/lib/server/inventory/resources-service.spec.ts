import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResultQueue: unknown[][] = [];
const updatedValues: Record<string, unknown>[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResultQueue.length > 0 ? selectResultQueue.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		update: vi.fn(() => ({
			set: vi.fn((v: Record<string, unknown>) => {
				updatedValues.push(v);
				return { where: vi.fn(() => Promise.resolve([])) };
			})
		})),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{}])) })),
				returning: vi.fn(() => Promise.resolve([{}]))
			}))
		})),
		delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))
	}
}));

vi.mock('./stock-service', () => ({
	recordMovement: vi.fn().mockResolvedValue({ id: 'mv-1' })
}));

vi.mock('$lib/server/media/media-service', () => ({ listFor: vi.fn().mockResolvedValue([]) }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string) => `https://cdn/${k}` }));

import { AssetNotReportableError, reportDamage } from './resources-service';
import { recordMovement } from './stock-service';

const ASSET = {
	id: 'as-1',
	itemId: 'it-1',
	status: 'in_service',
	condition: 'good',
	locationId: 'loc-1'
};

beforeEach(() => {
	vi.clearAllMocks();
	selectResultQueue = [];
	updatedValues.length = 0;
	vi.mocked(recordMovement).mockResolvedValue({ id: 'mv-1' } as never);
});

describe('reportDamage', () => {
	/**
	 * The report *is* the ledger entry. If the status change lands and the
	 * movement does not, the unit goes out of service with no record of why and
	 * the reporter's note is lost — which is exactly what shipped before this
	 * test existed.
	 */
	it('writes the movement that carries the note and the reporter', async () => {
		selectResultQueue = [[ASSET]];

		await reportDamage({
			assetId: 'as-1',
			note: 'Crackling on channel two',
			reportedByUserId: 'user-9'
		});

		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: 'it-1',
				assetId: 'as-1',
				reason: 'repair_out',
				actorId: 'user-9',
				notes: 'Crackling on channel two'
			})
		);
	});

	it('takes the unit out of service', async () => {
		selectResultQueue = [[ASSET]];
		await reportDamage({ assetId: 'as-1', note: 'x', reportedByUserId: 'u' });
		expect(updatedValues[0]).toMatchObject({ status: 'maintenance' });
	});

	it('records how bad the reporter thought it was', async () => {
		selectResultQueue = [[ASSET]];
		await reportDamage({
			assetId: 'as-1',
			note: 'x',
			reportedByUserId: 'u',
			condition: 'poor'
		});
		expect(updatedValues[0]).toMatchObject({ condition: 'poor' });
	});

	it('keeps the existing condition when the reporter did not say', async () => {
		selectResultQueue = [[ASSET]];
		await reportDamage({ assetId: 'as-1', note: 'x', reportedByUserId: 'u' });
		expect(updatedValues[0]).toMatchObject({ condition: 'good' });
	});

	it('refuses a unit already in the shop rather than recording nothing twice', async () => {
		selectResultQueue = [[{ ...ASSET, status: 'maintenance' }]];
		await expect(
			reportDamage({ assetId: 'as-1', note: 'x', reportedByUserId: 'u' })
		).rejects.toThrow(AssetNotReportableError);
		expect(recordMovement).not.toHaveBeenCalled();
	});

	it('accepts a report on a unit that is out on loan', async () => {
		selectResultQueue = [[{ ...ASSET, status: 'on_loan' }]];
		await expect(
			reportDamage({ assetId: 'as-1', note: 'x', reportedByUserId: 'u' })
		).resolves.toBeDefined();
	});
});
