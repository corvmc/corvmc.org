import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — records every statement the service builds, and lets each test queue
// what a select or a write resolves to. Real drizzle and real schema, so the
// recorded `set`/`values` are the rows that would actually be written.
// ---------------------------------------------------------------------------

interface Call {
	op: 'select' | 'insert' | 'update' | 'delete';
	table?: unknown;
	values?: unknown;
	set?: Record<string, unknown>;
	where?: unknown;
}

let calls: Call[] = [];
let selectResults: unknown[][] = [];
let writeResults: (unknown[] | Error)[] = [];

function chain(op: Call['op'], table: unknown, next: () => unknown[] | Error): unknown {
	const rec: Call = { op, table };
	calls.push(rec);
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void, reject: (e: unknown) => void) => {
					const result = next();
					if (result instanceof Error) reject(result);
					else resolve(result);
				};
			}
			if (prop === 'from')
				return (t: unknown) => {
					rec.table = t;
					return proxy;
				};
			if (prop === 'values')
				return (v: unknown) => {
					rec.values = v;
					return proxy;
				};
			if (prop === 'set')
				return (v: Record<string, unknown>) => {
					rec.set = v;
					return proxy;
				};
			if (prop === 'where')
				return (c: unknown) => {
					rec.where = c;
					return proxy;
				};
			return () => proxy;
		}
	});
	return proxy;
}

const nextSelect = () => selectResults.shift() ?? [];
const nextWrite = () => writeResults.shift() ?? [];

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain('select', null, nextSelect),
		insert: (t: unknown) => chain('insert', t, nextWrite),
		update: (t: unknown) => chain('update', t, nextWrite),
		delete: (t: unknown) => chain('delete', t, nextWrite),
		// The mock's builders already resolve, so batching is awaiting them together.
		batch: (queries: unknown[]) => Promise.all(queries as Promise<unknown>[])
	},
	getRowCount: () => 0
}));

const { productionSlot } = await import('$lib/server/db/schema/production');
const {
	addSlot,
	updateSlot,
	moveSlot,
	removeSlot,
	recomputeSetTimes,
	getPublicSetTimes,
	SlotExistsError,
	SlotNotFoundError,
	TooManySlotsError,
	SLOT_MAX
} = await import('./run-of-show-service');

const CREATED = new Date('2026-09-01T00:00:00Z');
const T0 = new Date('2026-09-12T03:30:00Z');

/** A row shaped the way the recompute's select reads it. */
function recomputeRow(over: Record<string, unknown> = {}) {
	return {
		firstSetAt: T0,
		slotId: 'slot-a',
		sortOrder: 1,
		createdAt: CREATED,
		setLengthMinutes: 30,
		changeoverMinutes: 10,
		scheduledStartAt: T0,
		...over
	};
}

const updatesTo = (table: unknown) => calls.filter((c) => c.op === 'update' && c.table === table);

beforeEach(() => {
	calls = [];
	selectResults = [];
	writeResults = [];
});

describe('recomputeSetTimes', () => {
	it('writes only the rows whose time actually moved', async () => {
		selectResults = [
			[
				recomputeRow({ slotId: 'a', sortOrder: 1, scheduledStartAt: T0 }),
				// Second set is stale: it still says the downbeat.
				recomputeRow({ slotId: 'b', sortOrder: 2, scheduledStartAt: T0 })
			]
		];

		await recomputeSetTimes('prod-1');

		const writes = updatesTo(productionSlot);
		expect(writes).toHaveLength(1);
		expect(writes[0].set?.scheduledStartAt).toEqual(new Date('2026-09-12T04:10:00Z'));
	});

	// The reason it is cheap enough to run on every mutation.
	it('writes nothing when every time is already right', async () => {
		selectResults = [[recomputeRow({ slotId: 'a', sortOrder: 1, scheduledStartAt: T0 })]];
		await recomputeSetTimes('prod-1');
		expect(updatesTo(productionSlot)).toHaveLength(0);
	});

	it('nulls every time when the production has no downbeat', async () => {
		selectResults = [[recomputeRow({ firstSetAt: null, scheduledStartAt: T0 })]];
		await recomputeSetTimes('prod-1');
		expect(updatesTo(productionSlot)[0].set?.scheduledStartAt).toBeNull();
	});

	it('does nothing for a production with no slots', async () => {
		selectResults = [[{ ...recomputeRow(), slotId: null }]];
		await recomputeSetTimes('prod-1');
		expect(updatesTo(productionSlot)).toHaveLength(0);
	});
});

describe('addSlot', () => {
	it('appends past the last set and recomputes', async () => {
		selectResults = [
			[{ id: 'a', sortOrder: 1, createdAt: CREATED }],
			[recomputeRow({ slotId: 'a', scheduledStartAt: null })]
		];
		writeResults = [[{ id: 'slot-new' }]];

		const id = await addSlot('prod-1', { eventBandId: 'eb-1', setLengthMinutes: 45 });

		expect(id).toBe('slot-new');
		const insert = calls.find((c) => c.op === 'insert')!;
		expect(insert.values).toMatchObject({
			sortOrder: 2,
			setLengthMinutes: 45,
			changeoverMinutes: 10
		});
	});

	// The partial unique is what holds the 1:1 with a credit, so the service reads
	// the violation rather than racing a select against it.
	it('turns a unique violation into SlotExistsError', async () => {
		selectResults = [[]];
		writeResults = [new Error('D1_ERROR: UNIQUE constraint failed: production_slot.event_band_id')];

		await expect(addSlot('prod-1', { eventBandId: 'eb-1', setLengthMinutes: 30 })).rejects.toThrow(
			SlotExistsError
		);
	});

	it('refuses a thirteenth set', async () => {
		selectResults = [
			Array.from({ length: SLOT_MAX }, (_, i) => ({
				id: `s-${i}`,
				sortOrder: i + 1,
				createdAt: CREATED
			}))
		];

		await expect(addSlot('prod-1', { setLengthMinutes: 30 })).rejects.toThrow(TooManySlotsError);
	});
});

describe('updateSlot', () => {
	it('recomputes when a set length changes', async () => {
		writeResults = [[{ productionId: 'prod-1' }]];
		selectResults = [[recomputeRow()]];

		await updateSlot('slot-a', { setLengthMinutes: 50 });

		expect(calls.filter((c) => c.op === 'select')).toHaveLength(1);
	});

	// A tech note cannot move a set time, and the guard keeps the common edit to
	// one round trip.
	it('does not recompute for a tech note', async () => {
		writeResults = [[{ productionId: 'prod-1' }]];

		await updateSlot('slot-a', { techNotes: 'Needs a wedge' });

		expect(calls.filter((c) => c.op === 'select')).toHaveLength(0);
	});

	it('throws when the slot is gone', async () => {
		writeResults = [[]];
		await expect(updateSlot('slot-a', { techNotes: 'x' })).rejects.toThrow(SlotNotFoundError);
	});
});

describe('moveSlot', () => {
	const order = [
		{ id: 'a', sortOrder: 1, createdAt: CREATED },
		{ id: 'b', sortOrder: 2, createdAt: CREATED },
		{ id: 'c', sortOrder: 3, createdAt: CREATED }
	];

	it('reorders with one write, at the midpoint of where it lands', async () => {
		selectResults = [[{ productionId: 'prod-1' }], order, [recomputeRow()]];

		await moveSlot('c', 'up');

		const reorders = updatesTo(productionSlot).filter((c) => c.set?.sortOrder !== undefined);
		expect(reorders).toHaveLength(1);
		expect(reorders[0].set?.sortOrder).toBe(1.5);
	});

	it('goes below the head rather than renumbering when it moves to the front', async () => {
		selectResults = [[{ productionId: 'prod-1' }], order, [recomputeRow()]];

		await moveSlot('b', 'up');

		const reorders = updatesTo(productionSlot).filter((c) => c.set?.sortOrder !== undefined);
		expect(reorders[0].set?.sortOrder).toBe(0);
	});

	it('is a no-op at the end it is already at', async () => {
		selectResults = [[{ productionId: 'prod-1' }], order];

		await moveSlot('a', 'up');

		expect(updatesTo(productionSlot)).toHaveLength(0);
	});

	it('throws when the slot is gone', async () => {
		selectResults = [[]];
		await expect(moveSlot('nope', 'up')).rejects.toThrow(SlotNotFoundError);
	});
});

describe('removeSlot', () => {
	it('recomputes after the delete', async () => {
		writeResults = [[{ productionId: 'prod-1' }]];
		selectResults = [[recomputeRow({ scheduledStartAt: null })]];

		await removeSlot('slot-a');

		expect(calls.some((c) => c.op === 'delete')).toBe(true);
		expect(updatesTo(productionSlot)).toHaveLength(1);
	});

	it('throws when the slot is gone', async () => {
		writeResults = [[]];
		await expect(removeSlot('slot-a')).rejects.toThrow(SlotNotFoundError);
	});
});

describe('getPublicSetTimes', () => {
	it('returns names in running order, not in the order the rows arrived', async () => {
		selectResults = [
			[
				{ name: 'Headliner', scheduledStartAt: T0, sortOrder: 3, createdAt: CREATED },
				{ name: 'Opener', scheduledStartAt: T0, sortOrder: 1, createdAt: CREATED }
			]
		];

		const times = await getPublicSetTimes('evt-1');

		expect(times.map((t) => t.name)).toEqual(['Opener', 'Headliner']);
	});
});
