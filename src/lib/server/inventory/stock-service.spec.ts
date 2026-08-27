import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
const batchCalls: unknown[][] = [];
const insertedValues: Record<string, unknown>[] = [];

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
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
				return { returning: vi.fn(() => Promise.resolve(insertResult)) };
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve([]))
			}))
		})),
		batch: vi.fn((stmts: unknown[]) => {
			batchCalls.push(stmts);
			return Promise.resolve(stmts.map(() => []));
		})
	}
}));

import {
	InvalidMovementError,
	getAvailableQuantity,
	getOnHand,
	getOnHandMany,
	recordMovement,
	signedQuantity,
	transferStock
} from './stock-service';
import { STOCK_REASON_SIGN } from '$lib/server/db/schema/inventory';
import { stockReasons } from '$lib/config';

beforeEach(() => {
	selectResult = [];
	selectResultQueue = [];
	insertResult = [{ id: 'm1' }];
	insertedValues.length = 0;
	batchCalls.length = 0;
});

// ---------------------------------------------------------------------------

describe('signedQuantity', () => {
	it('covers every reason in the vocabulary', () => {
		const missing = stockReasons.filter((r) => !(r in STOCK_REASON_SIGN));
		expect(missing, 'add these to STOCK_REASON_SIGN').toEqual([]);
	});

	it.each(['receive', 'loan_return', 'repair_in'] as const)('%s adds to stock', (reason) => {
		expect(signedQuantity(reason, 5)).toBe(5);
	});

	it.each(['loan_out', 'consume', 'repair_out', 'loss', 'retire'] as const)(
		'%s takes away from stock',
		(reason) => {
			expect(signedQuantity(reason, 5)).toBe(-5);
		}
	);

	/**
	 * The regression this guards: a service that can pass `-5` with reason
	 * `receive` can corrupt the ledger by typo, and nothing downstream would
	 * ever notice because the sum would simply be wrong.
	 */
	it('refuses to let a caller choose the direction of a one-way reason', () => {
		expect(() => signedQuantity('receive', -5)).toThrow(InvalidMovementError);
		expect(() => signedQuantity('consume', -5)).toThrow(InvalidMovementError);
		expect(() => signedQuantity('receive', 0)).toThrow(InvalidMovementError);
	});

	it('lets a stocktake adjustment go either way', () => {
		expect(signedQuantity('adjust', 3)).toBe(3);
		expect(signedQuantity('adjust', -3)).toBe(-3);
	});

	it('still refuses an adjustment of nothing', () => {
		expect(() => signedQuantity('adjust', 0)).toThrow(InvalidMovementError);
	});
});

describe('recordMovement', () => {
	it('writes the sign the reason implies, not the one it was handed', async () => {
		await recordMovement({ itemId: 'i1', quantity: 12, reason: 'consume' });
		expect(insertedValues[0]).toMatchObject({ itemId: 'i1', quantity: -12, reason: 'consume' });
	});

	it('carries the cause through so a movement can be traced back', async () => {
		await recordMovement({
			itemId: 'i1',
			quantity: 1,
			reason: 'loan_out',
			loanId: 'l1',
			assetId: 'a1'
		});
		expect(insertedValues[0]).toMatchObject({ loanId: 'l1', assetId: 'a1', quantity: -1 });
	});
});

describe('transferStock', () => {
	/**
	 * Written as a matched pair so a transfer nets to zero in every on-hand sum.
	 * The single-row alternative would need every future query to remember to
	 * exclude it, which is a correctness burden that only ever gets forgotten.
	 */
	it('writes a matched pair that nets to zero', async () => {
		await transferStock({
			itemId: 'i1',
			quantity: 4,
			fromLocationId: 'loc-a',
			toLocationId: 'loc-b'
		});

		expect(batchCalls).toHaveLength(1);
		expect(insertedValues).toHaveLength(2);
		const [out, into] = insertedValues;
		expect(out).toMatchObject({ quantity: -4, locationId: 'loc-a' });
		expect(into).toMatchObject({ quantity: 4, locationId: 'loc-b' });
		expect((out.quantity as number) + (into.quantity as number)).toBe(0);
	});

	it('refuses a transfer to the same place', async () => {
		await expect(
			transferStock({ itemId: 'i1', quantity: 1, fromLocationId: 'x', toLocationId: 'x' })
		).rejects.toThrow(InvalidMovementError);
	});

	it('refuses a transfer of nothing', async () => {
		await expect(
			transferStock({ itemId: 'i1', quantity: 0, fromLocationId: 'a', toLocationId: 'b' })
		).rejects.toThrow(InvalidMovementError);
	});
});

describe('getOnHand', () => {
	it('reads the sum of the ledger', async () => {
		selectResult = [{ onHand: 17 }];
		expect(await getOnHand('i1')).toBe(17);
	});

	it('is zero for an item with no movements at all', async () => {
		selectResult = [];
		expect(await getOnHand('i1')).toBe(0);
	});

	it('fills in a zero for items the ledger never mentions', async () => {
		selectResult = [{ itemId: 'i1', onHand: 5 }];
		const map = await getOnHandMany(['i1', 'i2']);
		expect(map.get('i1')).toBe(5);
		expect(map.get('i2')).toBe(0);
	});

	it('asks nothing of the database for an empty list', async () => {
		expect((await getOnHandMany([])).size).toBe(0);
	});
});

describe('getAvailableQuantity', () => {
	it('counts units in service for a serialized item, not the raw ledger', async () => {
		// kind lookup, then reserved-by-scheduled-loans, then the in-service count
		selectResultQueue = [[{ kind: 'serialized' }], [{ qty: 0 }], [{ n: 3 }]];
		expect(await getAvailableQuantity('i1')).toBe(3);
	});

	/**
	 * An amp in `maintenance` is on-hand and unavailable. Only the per-unit
	 * status knows that, which is why a serialized item cannot answer this from
	 * the ledger sum.
	 */
	it('leaves a unit under maintenance out of what can go out the door', async () => {
		selectResultQueue = [[{ kind: 'serialized' }], [{ qty: 0 }], [{ n: 2 }]];
		expect(await getAvailableQuantity('i1')).toBe(2);
	});

	it('subtracts stock already promised to a scheduled loan', async () => {
		selectResultQueue = [[{ kind: 'bulk' }], [{ qty: 2 }], [{ onHand: 10 }]];
		expect(await getAvailableQuantity('i1')).toBe(8);
	});

	it('never reports a negative availability', async () => {
		selectResultQueue = [[{ kind: 'bulk' }], [{ qty: 5 }], [{ onHand: 1 }]];
		expect(await getAvailableQuantity('i1')).toBe(0);
	});

	it('is zero for an item that does not exist', async () => {
		selectResultQueue = [[]];
		expect(await getAvailableQuantity('nope')).toBe(0);
	});
});
