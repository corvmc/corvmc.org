import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];

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
			values: vi.fn(() => {
				const p: any = Promise.resolve(insertResult);
				p.returning = () => Promise.resolve(insertResult);
				return p;
			})
		}))
	}
}));

vi.mock('./stock-service', () => ({
	recordMovement: vi.fn().mockResolvedValue({ id: 'mv-1' })
}));

vi.mock('./asset-service', () => ({
	createAsset: vi.fn().mockResolvedValue({ id: 'as-1' })
}));

import { adjustStock, consumeStock, isCapitalized, recordAcquisition } from './acquisition-service';
import { recordMovement } from './stock-service';
import { createAsset } from './asset-service';
import { CAPITALIZATION_THRESHOLD_CENTS } from '$lib/config';

beforeEach(() => {
	vi.resetAllMocks();
	selectResultQueue = [];
	insertResult = [{ id: 'acq-1' }];
	vi.mocked(recordMovement).mockResolvedValue({ id: 'mv-1' } as never);
	vi.mocked(createAsset).mockResolvedValue({ id: 'as-1' } as never);
});

describe('isCapitalized', () => {
	it('capitalizes at the threshold', () => {
		expect(isCapitalized(CAPITALIZATION_THRESHOLD_CENTS)).toBe(true);
	});

	it('expenses below it', () => {
		expect(isCapitalized(CAPITALIZATION_THRESHOLD_CENTS - 1)).toBe(false);
	});

	it('treats an unpriced arrival as expensed rather than guessing', () => {
		expect(isCapitalized(null)).toBe(false);
		expect(isCapitalized(undefined)).toBe(false);
	});
});

describe('recordAcquisition', () => {
	/**
	 * All receiving goes through an acquisition — including the $4 pack of
	 * strings. A `receive` with no cost or source is a row no later migration
	 * can improve, because by then the receipt is gone.
	 */
	it('receives bulk stock straight into the ledger', async () => {
		selectResultQueue = [[{ kind: 'bulk' }]];

		await recordAcquisition({
			kind: 'purchase',
			occurredAt: new Date('2026-08-01'),
			sourceName: 'Guitar Center',
			lines: [{ itemId: 'it-1', quantity: 20, unitValueCents: 400 }]
		});

		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: 'it-1',
				quantity: 20,
				reason: 'receive',
				acquisitionId: 'acq-1'
			})
		);
	});

	/**
	 * `createAsset` writes its own `receive`. Writing one here as well would
	 * double every serialized count on arrival.
	 */
	it('creates one unit per serialized item and does not double-count', async () => {
		selectResultQueue = [[{ kind: 'serialized' }]];

		await recordAcquisition({
			kind: 'purchase',
			occurredAt: new Date('2026-08-01'),
			lines: [{ itemId: 'it-1', quantity: 3, unitValueCents: 120_000 }]
		});

		expect(createAsset).toHaveBeenCalledTimes(3);
		expect(recordMovement).not.toHaveBeenCalled();
	});

	it('binds tags and serials to the units they came with', async () => {
		selectResultQueue = [[{ kind: 'serialized' }]];

		await recordAcquisition({
			kind: 'donation',
			occurredAt: new Date('2026-08-01'),
			donorUserId: 'user-1',
			fairValueBasis: 'Reverb comparable sales',
			intendedUse: 'Practice room backline',
			lines: [
				{
					itemId: 'it-1',
					quantity: 1,
					unitValueCents: 250_000,
					units: [{ assetTag: 'CMC-000123', serialNumber: 'LP-9981', condition: 'excellent' }]
				}
			]
		});

		expect(createAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				assetTag: 'CMC-000123',
				serialNumber: 'LP-9981',
				condition: 'excellent',
				acquisitionId: 'acq-1'
			})
		);
	});

	it('defaults a unit with no stated condition rather than refusing the gift', async () => {
		selectResultQueue = [[{ kind: 'serialized' }]];

		await recordAcquisition({
			kind: 'donation',
			occurredAt: new Date('2026-08-01'),
			lines: [{ itemId: 'it-1', quantity: 1 }]
		});

		expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({ condition: 'good' }));
	});
});

describe('consumeStock', () => {
	it('is the one movement with no return leg', async () => {
		await consumeStock({ itemId: 'it-1', quantity: 3 });
		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: 'it-1', quantity: 3, reason: 'consume' })
		);
	});
});

describe('adjustStock', () => {
	/**
	 * The honest way to change a count: a stocktake correction is itself a
	 * ledger row, so the discrepancy stays visible instead of a total being
	 * quietly overwritten — which is what the old schema forced.
	 */
	it('records a correction in both directions', async () => {
		await adjustStock({ itemId: 'it-1', delta: -2, notes: 'stocktake' });
		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({ quantity: -2, reason: 'adjust', notes: 'stocktake' })
		);

		await adjustStock({ itemId: 'it-1', delta: 5 });
		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({ quantity: 5, reason: 'adjust' })
		);
	});
});
