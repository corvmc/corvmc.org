import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `recordAcquisitionBulk` — the write path a stocktake depends on.
 *
 * Its own file rather than a block in `acquisition-service.spec.ts`, because
 * that file's `db` mock is built for the sequential path: `insert().values()`
 * resolving to a row, no `batch`, and a `select` that answers from a queue in
 * call order. Unioning the two mocks would quietly change what the older tests
 * exercise, which is the trap `docs` calls out about merging spec preambles.
 *
 * What is asserted here is the *shape of the traffic*, not just the result:
 * the whole reason this function exists is that the sequential path costs a
 * round trip per unit, so a test that only checked the returned counts could
 * pass against an implementation that had regressed to a loop.
 */

type Captured = { table: string; rows: unknown[] };

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];
let selectCalls = 0;
let batchCalls = 0;

/** Reads the table a drizzle insert was aimed at, without a real driver. */
function tableNameOf(t: unknown): string {
	const symbols = Object.getOwnPropertySymbols(t as object);
	for (const sym of symbols) {
		if (String(sym).includes('Name')) {
			const v = (t as Record<symbol, unknown>)[sym];
			if (typeof v === 'string') return v;
		}
	}
	return 'unknown';
}

vi.mock('$lib/server/db', () => {
	const selectChain = () => {
		const proxy: unknown = new Proxy(() => proxy, {
			get(_, prop) {
				if (prop === 'then') {
					return (resolve: (v: unknown[]) => void) => {
						selectCalls += 1;
						resolve(selectQueue.length > 0 ? selectQueue.shift()! : []);
					};
				}
				return () => proxy;
			}
		}) as unknown;
		return proxy;
	};

	return {
		db: {
			select: vi.fn(() => selectChain()),
			insert: vi.fn((table: unknown) => ({
				values: (rows: unknown) => ({
					__table: tableNameOf(table),
					__rows: Array.isArray(rows) ? rows : [rows]
				})
			})),
			batch: vi.fn(async (statements: { __table: string; __rows: unknown[] }[]) => {
				batchCalls += 1;
				for (const st of statements) captured.push({ table: st.__table, rows: st.__rows });
				return [];
			})
		}
	};
});

vi.mock('./stock-service', () => ({
	recordMovement: vi.fn(),
	signedQuantity: (reason: string, quantity: number) =>
		reason === 'receive' ? quantity : -quantity
}));

vi.mock('./asset-service', () => ({
	createAsset: vi.fn(),
	AssetTagTakenError: class AssetTagTakenError extends Error {}
}));

vi.mock('$lib/server/media/media-service', () => ({ listFor: vi.fn() }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: vi.fn() }));

const { recordAcquisitionBulk, DuplicateAssetTagError, UnknownItemError, InvalidAcquisitionError } =
	await import('./acquisition-service');

const SERIALIZED = 'item-serialized';
const BULK = 'item-bulk';

/** Both items resolve live; no tag is taken. */
function happyPath(extraSelects: unknown[][] = []) {
	selectQueue = [
		[
			{ id: SERIALIZED, kind: 'serialized' },
			{ id: BULK, kind: 'bulk' }
		],
		...extraSelects
	];
}

function rowsFor(table: string) {
	return captured.filter((c) => c.table === table).flatMap((c) => c.rows);
}

beforeEach(() => {
	captured = [];
	selectQueue = [];
	selectCalls = 0;
	batchCalls = 0;
	vi.clearAllMocks();
});

const base = {
	kind: 'opening_balance' as const,
	occurredAt: new Date('2026-03-01T12:00:00Z'),
	recordedByUserId: 'staff-1'
};

describe('recordAcquisitionBulk', () => {
	it('writes one asset and one receive per serialized unit', async () => {
		happyPath();

		const result = await recordAcquisitionBulk({
			...base,
			lines: [{ itemId: SERIALIZED, quantity: 3 }]
		});

		expect(result.unitCount).toBe(3);
		expect(rowsFor('inventory_asset')).toHaveLength(3);
		expect(rowsFor('stock_movement')).toHaveLength(3);

		// The ledger's own invariant: for a serialized item, on-hand is the count
		// of its live units, so the movements must sum to the units created.
		const sum = (rowsFor('stock_movement') as { quantity: number }[]).reduce(
			(t, m) => t + m.quantity,
			0
		);
		expect(sum).toBe(3);
	});

	it('writes one receive for a bulk line, not one per counted unit', async () => {
		happyPath();

		const result = await recordAcquisitionBulk({
			...base,
			lines: [{ itemId: BULK, quantity: 24 }]
		});

		expect(result.unitCount).toBe(0);
		expect(rowsFor('inventory_asset')).toHaveLength(0);
		const movements = rowsFor('stock_movement') as { quantity: number; assetId: null }[];
		expect(movements).toHaveLength(1);
		expect(movements[0].quantity).toBe(24);
	});

	it('hangs every row off one acquisition id', async () => {
		happyPath();

		const result = await recordAcquisitionBulk({
			...base,
			lines: [
				{ itemId: SERIALIZED, quantity: 2 },
				{ itemId: BULK, quantity: 5 }
			]
		});

		const ids = new Set(
			captured
				.flatMap((c) => c.rows as { acquisitionId?: string; id?: string }[])
				.map((r) => r.acquisitionId)
				.filter(Boolean)
		);
		expect([...ids]).toEqual([result.acquisitionId]);
	});

	/**
	 * The point of the whole function. A sequential implementation would issue a
	 * select per line and several per unit; this issues two selects total, and
	 * the second only because a tag was named.
	 */
	it('resolves every item in one query regardless of line count', async () => {
		happyPath();

		await recordAcquisitionBulk({
			...base,
			lines: Array.from({ length: 40 }, () => ({ itemId: BULK, quantity: 1 }))
		});

		expect(selectCalls).toBe(1);
	});

	it('splits inserts under D1 bound-parameter cap', async () => {
		happyPath();

		// 60 units: 8 columns per asset row caps a statement at 12 rows.
		await recordAcquisitionBulk({
			...base,
			lines: [{ itemId: SERIALIZED, quantity: 60 }]
		});

		const assetStatements = captured.filter((c) => c.table === 'inventory_asset');
		expect(assetStatements.length).toBeGreaterThan(1);
		for (const st of assetStatements) {
			expect(st.rows.length * 8).toBeLessThanOrEqual(100);
		}
	});

	it('refuses two identical tags inside one payload', async () => {
		// The database cannot catch this: neither row exists yet, so `assertTagFree`
		// would pass both and the collision would land mid-write.
		happyPath();

		await expect(
			recordAcquisitionBulk({
				...base,
				lines: [
					{
						itemId: SERIALIZED,
						quantity: 2,
						units: [{ assetTag: 'CMC-1' }, { assetTag: 'CMC-1' }]
					}
				]
			})
		).rejects.toThrow(DuplicateAssetTagError);

		expect(batchCalls).toBe(0);
	});

	it('refuses a tag the database already holds, before writing anything', async () => {
		happyPath([[{ assetTag: 'CMC-9' }]]);

		await expect(
			recordAcquisitionBulk({
				...base,
				lines: [{ itemId: SERIALIZED, quantity: 1, units: [{ assetTag: 'CMC-9' }] }]
			})
		).rejects.toThrow();

		expect(batchCalls).toBe(0);
	});

	it('refuses an item that is not live', async () => {
		selectQueue = [[{ id: SERIALIZED, kind: 'serialized' }]];

		await expect(
			recordAcquisitionBulk({
				...base,
				lines: [
					{ itemId: SERIALIZED, quantity: 1 },
					{ itemId: 'item-deleted', quantity: 1 }
				]
			})
		).rejects.toThrow(UnknownItemError);

		expect(batchCalls).toBe(0);
	});

	it('refuses units on a bulk line', async () => {
		happyPath();

		await expect(
			recordAcquisitionBulk({
				...base,
				lines: [{ itemId: BULK, quantity: 1, units: [{ assetTag: 'CMC-2' }] }]
			})
		).rejects.toThrow(InvalidAcquisitionError);
	});

	it('refuses an empty payload', async () => {
		await expect(recordAcquisitionBulk({ ...base, lines: [] })).rejects.toThrow(
			InvalidAcquisitionError
		);
		expect(selectCalls).toBe(0);
	});

	it('leaves an untagged unit untagged rather than inventing one', async () => {
		happyPath();

		await recordAcquisitionBulk({
			...base,
			lines: [{ itemId: SERIALIZED, quantity: 2, units: [{ assetTag: 'CMC-3' }, {}] }]
		});

		const assets = rowsFor('inventory_asset') as { assetTag: string | null }[];
		expect(assets.map((a) => a.assetTag)).toEqual(['CMC-3', null]);
	});
});
