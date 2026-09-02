import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResultQueue: unknown[][] = [];
const insertedValues: Record<string, unknown>[] = [];

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
			values: vi.fn((v: Record<string, unknown>) => {
				insertedValues.push(v);
				return { returning: vi.fn(() => Promise.resolve([{ id: 'flag-1', ...v }])) };
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) }))
		}))
	}
}));

vi.mock('./asset-service', () => ({
	setAssetStatus: vi.fn().mockResolvedValue(undefined),
	AssetNotFoundError: class extends Error {
		constructor() {
			super('Asset not found');
			this.name = 'AssetNotFoundError';
		}
	}
}));

import { raiseFlag, AssetNotFlaggableError } from './asset-flag-service';
import { setAssetStatus, AssetNotFoundError } from './asset-service';

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
	insertedValues.length = 0;
});

describe('raiseFlag', () => {
	it('records the note and the reporter', async () => {
		selectResultQueue = [[ASSET]];

		await raiseFlag({
			assetId: 'as-1',
			note: 'Crackling on channel two',
			reportedByUserId: 'user-9',
			blocksUse: true
		});

		expect(insertedValues[0]).toMatchObject({
			assetId: 'as-1',
			note: 'Crackling on channel two',
			reportedByUserId: 'user-9',
			blocksUse: true
		});
	});

	/**
	 * The safety case the old immediate-pull behaviour existed for: the cost of a
	 * wrong pull is a staffer clicking it back, and the cost of leaving a broken
	 * amp bookable is the next member's session.
	 */
	it('takes a unit out of service when it is ours and unusable', async () => {
		selectResultQueue = [[ASSET]];

		await raiseFlag({
			assetId: 'as-1',
			note: 'Jack is snapped',
			reportedByUserId: 'u',
			blocksUse: true,
			condition: 'poor'
		});

		expect(setAssetStatus).toHaveBeenCalledWith(
			'as-1',
			'maintenance',
			expect.objectContaining({ condition: 'poor', actorId: 'u' })
		);
	});

	/**
	 * A torn tolex is worth knowing and does not stop anybody playing. Before
	 * flags existed there was nowhere to put this: reporting *was* the pull, so
	 * the only way to record it was to take the amp off the shelf.
	 */
	it('leaves a usable unit in service', async () => {
		selectResultQueue = [[ASSET]];

		await raiseFlag({
			assetId: 'as-1',
			note: 'Tolex torn on the corner',
			reportedByUserId: 'u',
			blocksUse: false
		});

		expect(insertedValues).toHaveLength(1);
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	/**
	 * `maintenance` means "in our possession and not rentable", so it is not a
	 * status a loaned unit can be in. Noticing a crackle does not hand the amp
	 * back to the collective — `returnLoan` decides that when it physically
	 * arrives.
	 */
	it('does not touch the status of a unit that is still out on loan', async () => {
		selectResultQueue = [[{ ...ASSET, status: 'on_loan' }]];

		await raiseFlag({
			assetId: 'as-1',
			note: 'Hums badly',
			reportedByUserId: 'u',
			blocksUse: true
		});

		expect(insertedValues).toHaveLength(1);
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	/**
	 * The second person to notice is data, not an error. This used to throw,
	 * which meant only the first reporter was ever attributable and nobody could
	 * be told "known issue" — there was no row of theirs to say it against.
	 */
	it('accepts a second report on a unit already in the shop', async () => {
		selectResultQueue = [[{ ...ASSET, status: 'maintenance' }]];

		await raiseFlag({
			assetId: 'as-1',
			note: 'Also the handle is loose',
			reportedByUserId: 'someone-else',
			blocksUse: true
		});

		expect(insertedValues).toHaveLength(1);
		// Already out of service; nothing to pull.
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a retired unit, which has nothing left to report against', async () => {
		selectResultQueue = [[{ ...ASSET, status: 'retired' }]];

		await expect(
			raiseFlag({ assetId: 'as-1', note: 'x', reportedByUserId: 'u', blocksUse: true })
		).rejects.toThrow(AssetNotFlaggableError);
		expect(insertedValues).toHaveLength(0);
	});

	it('throws when the unit does not exist', async () => {
		selectResultQueue = [[]];

		await expect(
			raiseFlag({ assetId: 'nope', note: 'x', reportedByUserId: 'u', blocksUse: true })
		).rejects.toThrow(AssetNotFoundError);
	});
});
