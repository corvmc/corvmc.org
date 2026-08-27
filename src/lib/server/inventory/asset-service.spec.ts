import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
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
		insert: vi.fn(() => ({
			values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(insertResult)) }))
		})),
		update: vi.fn(() => ({
			set: vi.fn((v: Record<string, unknown>) => {
				updatedValues.push(v);
				return {
					where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(updateResult)) }))
				};
			})
		}))
	}
}));

vi.mock('./stock-service', () => ({
	recordMovement: vi.fn().mockResolvedValue({ id: 'mv-1' })
}));

import {
	AssetTagTakenError,
	InvalidAssetTransitionError,
	NotSerializedError,
	bindAssetTag,
	createAsset,
	setAssetStatus
} from './asset-service';
import { recordMovement } from './stock-service';

beforeEach(() => {
	vi.resetAllMocks();
	selectResultQueue = [];
	insertResult = [{ id: 'as-1' }];
	updateResult = [{ id: 'as-1' }];
	updatedValues.length = 0;
	vi.mocked(recordMovement).mockResolvedValue({ id: 'mv-1' } as never);
});

describe('createAsset', () => {
	/**
	 * On-hand for a serialized item is the ledger sum, so an asset created
	 * without a `receive` would be invisible to every availability check — it
	 * would exist on the shelf and not in the system.
	 */
	it('writes the receive that makes the unit count', async () => {
		selectResultQueue = [[{ kind: 'serialized' }]];
		await createAsset({ itemId: 'it-1', condition: 'good' });

		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: 'it-1', assetId: 'as-1', quantity: 1, reason: 'receive' })
		);
	});

	it('refuses to give a bulk item individual units', async () => {
		selectResultQueue = [[{ kind: 'bulk' }]];
		await expect(createAsset({ itemId: 'it-1', condition: 'good' })).rejects.toThrow(
			NotSerializedError
		);
	});

	it('refuses a tag already bound to something else', async () => {
		selectResultQueue = [[{ kind: 'serialized' }], [{ id: 'other-asset' }]];
		await expect(
			createAsset({ itemId: 'it-1', condition: 'good', assetTag: 'CMC-000123' })
		).rejects.toThrow(AssetTagTakenError);
	});
});

describe('bindAssetTag', () => {
	/**
	 * Stickers come off amps. Rebinding is an ordinary event, and the asset keeps
	 * its id, history and loans — the identity is the row, never the label.
	 */
	it('rebinds a unit to a fresh tag', async () => {
		selectResultQueue = [[]];
		const row = await bindAssetTag('as-1', 'CMC-000999');
		expect(row.id).toBe('as-1');
		expect(updatedValues[0]).toMatchObject({ assetTag: 'CMC-000999' });
	});

	it('lets a unit keep the tag it already has', async () => {
		selectResultQueue = [[{ id: 'as-1' }]];
		await expect(bindAssetTag('as-1', 'CMC-000123')).resolves.toBeDefined();
	});

	it('refuses a tag another unit is wearing', async () => {
		selectResultQueue = [[{ id: 'as-2' }]];
		await expect(bindAssetTag('as-1', 'CMC-000123')).rejects.toThrow(AssetTagTakenError);
	});
});

describe('setAssetStatus', () => {
	it('takes a unit out of service and says so in the ledger', async () => {
		selectResultQueue = [[{ id: 'as-1', itemId: 'it-1', status: 'in_service', locationId: null }]];
		await setAssetStatus('as-1', 'maintenance', { notes: 'torn grille' });

		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'repair_out', quantity: 1 })
		);
	});

	it('brings it back with the matching entry', async () => {
		selectResultQueue = [[{ id: 'as-1', itemId: 'it-1', status: 'maintenance', locationId: null }]];
		await setAssetStatus('as-1', 'in_service');

		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'repair_in', quantity: 1 })
		);
	});

	/**
	 * Retirement writes a movement rather than deleting the row: an asset's
	 * history — every loan, every repair — has to outlive the asset.
	 */
	it('retires by writing a movement, never by deleting', async () => {
		selectResultQueue = [[{ id: 'as-1', itemId: 'it-1', status: 'in_service', locationId: null }]];
		await setAssetStatus('as-1', 'retired', { notes: 'beyond repair' });

		expect(recordMovement).toHaveBeenCalledWith(expect.objectContaining({ reason: 'retire' }));
		expect(updatedValues[0]).toMatchObject({ status: 'retired', retiredReason: 'beyond repair' });
	});

	it.each(['retired', 'lost'] as const)('will not bring a %s unit back', async (terminal) => {
		selectResultQueue = [[{ id: 'as-1', itemId: 'it-1', status: terminal, locationId: null }]];
		await expect(setAssetStatus('as-1', 'in_service')).rejects.toThrow(InvalidAssetTransitionError);
	});

	/**
	 * The loan lifecycle writes `loan_out` / `loan_return` itself. Writing one
	 * here too would decrement the same amp twice.
	 */
	it('writes nothing extra when a loan moves the unit', async () => {
		selectResultQueue = [[{ id: 'as-1', itemId: 'it-1', status: 'in_service', locationId: null }]];
		await setAssetStatus('as-1', 'on_loan');
		expect(recordMovement).not.toHaveBeenCalled();
	});

	it('does nothing at all when the status is already right', async () => {
		selectResultQueue = [[{ id: 'as-1', itemId: 'it-1', status: 'in_service', locationId: null }]];
		await setAssetStatus('as-1', 'in_service');
		expect(recordMovement).not.toHaveBeenCalled();
		expect(updatedValues).toHaveLength(0);
	});
});
