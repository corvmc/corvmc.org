import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
let updateCalls: unknown[] = [];
/** Every `insert().values()` payload, so a header's own columns can be asserted. */
let insertCalls: unknown[] = [];

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
			values: vi.fn((values: unknown) => {
				insertCalls.push(values);
				const p: any = Promise.resolve(insertResult);
				p.returning = () => Promise.resolve(insertResult);
				return p;
			})
		})),
		// The amend paths are `update().set().where().returning()`. `set` is
		// captured so a test can assert *what* was written, which is the only
		// thing worth asserting against a mocked driver.
		update: vi.fn(() => ({
			set: vi.fn((values: unknown) => {
				updateCalls.push(values);
				const p: any = Promise.resolve(updateResult);
				p.where = () => {
					const q: any = Promise.resolve(updateResult);
					q.returning = () => Promise.resolve(updateResult);
					return q;
				};
				return p;
			})
		}))
	}
}));

vi.mock('./stock-service', () => ({
	recordMovement: vi.fn().mockResolvedValue({ id: 'mv-1' }),
	// `recordAcquisitionBulk` shares the sign convention rather than restating
	// it, so this module now exports two things and the mock has to carry both —
	// a mock missing one fails the whole file at import, not at the assertion.
	signedQuantity: (reason: string, quantity: number) =>
		reason === 'receive' ? quantity : -quantity
}));

vi.mock('./asset-service', () => ({
	createAsset: vi.fn().mockResolvedValue({ id: 'as-1' }),
	AssetTagTakenError: class AssetTagTakenError extends Error {}
}));

import {
	acknowledgeForm8283,
	adjustStock,
	consumeStock,
	markReimbursed,
	addAcquisitionLine,
	recordAcquisition,
	updateAcquisition,
	AcquisitionNotFoundError
} from './acquisition-service';
import { recordMovement } from './stock-service';
import { createAsset } from './asset-service';

beforeEach(() => {
	vi.resetAllMocks();
	selectResultQueue = [];
	insertResult = [{ id: 'acq-1' }];
	updateResult = [{ id: 'acq-1' }];
	updateCalls = [];
	insertCalls = [];
	vi.mocked(recordMovement).mockResolvedValue({ id: 'mv-1' } as never);
	vi.mocked(createAsset).mockResolvedValue({ id: 'as-1' } as never);
});

describe('addAcquisitionLine', () => {
	/**
	 * The point of recording a receipt before anyone itemises it: the stock has
	 * to move when the line is added, not when the header was. A line that only
	 * wrote its row would leave the on-hand count disagreeing with the register
	 * that explains it.
	 */
	it('receives the stock, not just the row', async () => {
		selectResultQueue = [[{ id: 'acq-1' }], [{ kind: 'bulk' }]];

		await addAcquisitionLine(
			'acq-1',
			{ itemId: 'it-1', quantity: 4, unitValueCents: 250 },
			'user-1'
		);

		expect(recordMovement).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: 'it-1',
				quantity: 4,
				reason: 'receive',
				acquisitionId: 'acq-1'
			})
		);
	});

	// The same split `recordAcquisition` makes: `createAsset` writes its own
	// receive, so a serialized line must not write a second one.
	it('creates one unit per quantity for a serialized item', async () => {
		selectResultQueue = [[{ id: 'acq-1' }], [{ kind: 'serialized' }]];

		await addAcquisitionLine('acq-1', { itemId: 'it-1', quantity: 2 }, 'user-1');

		expect(createAsset).toHaveBeenCalledTimes(2);
		expect(recordMovement).not.toHaveBeenCalled();
	});

	it('refuses a line against an acquisition that does not exist', async () => {
		selectResultQueue = [[]];

		await expect(addAcquisitionLine('nope', { itemId: 'it-1', quantity: 1 })).rejects.toThrow();
		expect(recordMovement).not.toHaveBeenCalled();
		expect(createAsset).not.toHaveBeenCalled();
	});

	it('refuses a quantity that is not a whole number of at least one', async () => {
		await expect(addAcquisitionLine('acq-1', { itemId: 'it-1', quantity: 0 })).rejects.toThrow();
		// Rejected before the acquisition is even looked up.
		expect(recordMovement).not.toHaveBeenCalled();
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
	 * A receipt photographed now and itemised later by whoever can read it. The
	 * register already tolerated this on the read side — every total falls back
	 * to the lines — but the write side required at least one.
	 */
	it('records a header with no lines at all', async () => {
		const row = await recordAcquisition({
			kind: 'donation',
			occurredAt: new Date('2026-09-13'),
			sourceName: 'Committee cleanup',
			totalCents: 8240
		});

		expect(row).toBeDefined();
		expect(recordMovement).not.toHaveBeenCalled();
		expect(createAsset).not.toHaveBeenCalled();
	});

	// The distinction the schema warns about: a member who gave is not a member
	// who is owed, and the two must not collapse into one column.
	it('keeps the donor and the payer apart', async () => {
		await recordAcquisition({
			kind: 'donation',
			occurredAt: new Date('2026-09-13'),
			donorUserId: 'user-donor',
			totalCents: 8240
		});

		expect(insertCalls.at(0)).toMatchObject({
			donorUserId: 'user-donor',
			paidByUserId: null,
			totalCents: 8240
		});
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

/**
 * The amend paths, which exist because receiving captures what is known at the
 * door and several of these answers do not exist yet at that moment.
 *
 * Against a mocked driver the only thing worth asserting is *what was written*
 * and *what refused to write*. The queries themselves are covered for real in
 * `reports.spec.ts`.
 */
describe('updateAcquisition', () => {
	it('writes the disclosure fields receiving could not capture', async () => {
		await updateAcquisition('acq-1', {
			fairValueCents: 600_000,
			monetized: true,
			appraisalRef: 'Appraisal 2026-04'
		});

		expect(updateCalls[0]).toMatchObject({
			fairValueCents: 600_000,
			monetized: true,
			appraisalRef: 'Appraisal 2026-04'
		});
	});

	it('refuses an acquisition that is not there', async () => {
		updateResult = [];
		await expect(updateAcquisition('nope', { notes: 'x' })).rejects.toBeInstanceOf(
			AcquisitionNotFoundError
		);
	});
});

describe('acknowledgeForm8283', () => {
	/**
	 * The switch that arms Form 8282. `form8282Status` treats a gift with no
	 * signed 8283 as owing nothing, so until this writes, disposing of a donated
	 * unit raises no warning at all — which is exactly the state the module
	 * shipped in.
	 */
	it('records the signature and the appraisal reference', async () => {
		const signed = new Date('2026-04-02T00:00:00Z');
		await acknowledgeForm8283('acq-1', { acknowledgedAt: signed, appraisalRef: 'A-17' });

		expect(updateCalls[0]).toMatchObject({ acknowledgedAt: signed, appraisalRef: 'A-17' });
	});

	/** "We recorded that in error" has to be as expressible as recording it. */
	it('can unsign one', async () => {
		await acknowledgeForm8283('acq-1', { acknowledgedAt: null });
		expect(updateCalls[0]).toMatchObject({ acknowledgedAt: null, appraisalRef: null });
	});

	it('refuses an acquisition that is not there', async () => {
		updateResult = [];
		await expect(
			acknowledgeForm8283('nope', { acknowledgedAt: new Date() })
		).rejects.toBeInstanceOf(AcquisitionNotFoundError);
	});
});

describe('markReimbursed', () => {
	it('stamps the date somebody was paid back', async () => {
		selectResultQueue = [[{ reimbursedAt: null, paidByUserId: 'u-1' }]];
		const now = new Date('2026-08-20T00:00:00Z');

		expect(await markReimbursed('acq-1', now)).toBe(now);
		expect(updateCalls[0]).toMatchObject({ reimbursedAt: now });
	});

	/**
	 * A double click must not rewrite when somebody was actually paid — the
	 * original date is the record, and moving it would quietly falsify it.
	 */
	it('keeps the original date rather than moving it', async () => {
		const settled = new Date('2026-05-01T00:00:00Z');
		selectResultQueue = [[{ reimbursedAt: settled, paidByUserId: 'u-1' }]];

		expect(await markReimbursed('acq-1', new Date('2026-08-20T00:00:00Z'))).toBe(settled);
		expect(updateCalls).toEqual([]);
	});

	it('refuses an acquisition that is not there', async () => {
		selectResultQueue = [[]];
		await expect(markReimbursed('nope')).rejects.toBeInstanceOf(AcquisitionNotFoundError);
	});
});
