import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Purchase orders.
 *
 * The behaviour worth pinning is the partial receipt: a supplier ships six of
 * ten and the order has to stay open with four outstanding. A boolean cannot
 * express that, which is why `quantityReceived` is a number per line and why
 * completion is recomputed from the rows rather than inferred from the last
 * write.
 */

let selectResults: unknown[][] = [];
let updateCalls: { values: unknown }[] = [];
let batchCalls = 0;

function chain(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResults.length > 0 ? selectResults.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain()),
		insert: vi.fn(() => ({ values: (v: unknown) => ({ __insert: v }) })),
		update: vi.fn(() => ({
			set: (values: unknown) => {
				updateCalls.push({ values });
				const p: unknown = Promise.resolve([]);
				(p as { where?: unknown }).where = () => Promise.resolve([]);
				return p;
			}
		})),
		batch: vi.fn(async () => {
			batchCalls += 1;
			return [];
		})
	}
}));

const {
	applyReceipt,
	placeOrder,
	cancelOrder,
	closeOrderShort,
	OrderStateError,
	OrderNotFoundError
} = await import('./order-service');

beforeEach(() => {
	selectResults = [];
	updateCalls = [];
	batchCalls = 0;
	vi.clearAllMocks();
});

const ORDER = 'order-1';

describe('placeOrder', () => {
	it('moves a draft to placed and stamps when', async () => {
		selectResults = [[{ id: ORDER, status: 'draft' }]];
		await placeOrder(ORDER, new Date('2026-04-01T12:00:00Z'));

		const set = updateCalls[0].values as { status: string; placedAt: Date };
		expect(set.status).toBe('placed');
		expect(set.placedAt).toEqual(new Date('2026-04-01T12:00:00Z'));
	});

	it('refuses to place an order twice', async () => {
		selectResults = [[{ id: ORDER, status: 'placed' }]];
		await expect(placeOrder(ORDER)).rejects.toThrow(OrderStateError);
		expect(updateCalls).toHaveLength(0);
	});

	it('reports a missing order rather than writing blind', async () => {
		selectResults = [[]];
		await expect(placeOrder(ORDER)).rejects.toThrow(OrderNotFoundError);
	});
});

describe('cancelOrder', () => {
	it('refuses to cancel something already received', async () => {
		// The acquisition hanging off it is the proof that goods arrived; the
		// order cannot retroactively claim they did not.
		selectResults = [[{ id: ORDER, status: 'received' }]];
		await expect(cancelOrder(ORDER)).rejects.toThrow(OrderStateError);
	});
});

describe('applyReceipt', () => {
	it('leaves a partly-filled order open', async () => {
		selectResults = [
			[{ id: ORDER, status: 'placed' }],
			[
				{ id: 'l1', orderId: ORDER, itemId: 'i1', quantityOrdered: 10, quantityReceived: 0 },
				{ id: 'l2', orderId: ORDER, itemId: 'i2', quantityOrdered: 4, quantityReceived: 0 }
			],
			// Re-read after the writes: six of ten, none of four.
			[
				{ id: 'l1', quantityOrdered: 10, quantityReceived: 6 },
				{ id: 'l2', quantityOrdered: 4, quantityReceived: 0 }
			]
		];

		const { complete } = await applyReceipt({
			orderId: ORDER,
			acquisitionId: 'acq-1',
			received: [{ itemId: 'i1', quantity: 6 }]
		});

		expect(complete).toBe(false);
		// One batch: the line bump and the acquisition link, together.
		expect(batchCalls).toBe(1);
		// And nothing flipped the status — the batched writes are recorded here
		// too, so the assertion is about intent, not about the call count.
		expect(updateCalls.some((c) => 'status' in (c.values as object))).toBe(false);
	});

	it('closes an order once every line is fulfilled', async () => {
		selectResults = [
			[{ id: ORDER, status: 'placed' }],
			[{ id: 'l1', orderId: ORDER, itemId: 'i1', quantityOrdered: 10, quantityReceived: 4 }],
			[{ id: 'l1', quantityOrdered: 10, quantityReceived: 10 }]
		];

		const { complete } = await applyReceipt({
			orderId: ORDER,
			acquisitionId: 'acq-2',
			received: [{ itemId: 'i1', quantity: 6 }]
		});

		expect(complete).toBe(true);
		expect((updateCalls.at(-1)!.values as { status: string }).status).toBe('received');
	});

	it('ignores an item the order never asked for', async () => {
		// A supplier substitutes, or somebody adds to the trip. It belongs on the
		// acquisition — which already has it — and simply not on the order.
		selectResults = [
			[{ id: ORDER, status: 'placed' }],
			[{ id: 'l1', orderId: ORDER, itemId: 'i1', quantityOrdered: 2, quantityReceived: 0 }],
			[{ id: 'l1', quantityOrdered: 2, quantityReceived: 0 }]
		];

		const { complete } = await applyReceipt({
			orderId: ORDER,
			acquisitionId: 'acq-3',
			received: [{ itemId: 'not-on-this-order', quantity: 5 }]
		});

		expect(complete).toBe(false);
		// Still one batch — the acquisition link is written regardless.
		expect(batchCalls).toBe(1);
	});

	it('refuses to receive against a cancelled order', async () => {
		selectResults = [[{ id: ORDER, status: 'cancelled' }]];
		await expect(
			applyReceipt({ orderId: ORDER, acquisitionId: 'acq-4', received: [] })
		).rejects.toThrow(OrderStateError);
	});
});

describe('closeOrderShort', () => {
	it('marks a placed order received even with lines outstanding', async () => {
		// "The rest is never coming" is a real outcome, and leaving the order
		// open forever would keep suppressing restock suggestions for goods that
		// will not arrive.
		selectResults = [[{ id: ORDER, status: 'placed' }]];
		await closeOrderShort(ORDER);
		expect((updateCalls[0].values as { status: string }).status).toBe('received');
	});

	it('refuses on a draft, which was never sent to anyone', async () => {
		selectResults = [[{ id: ORDER, status: 'draft' }]];
		await expect(closeOrderShort(ORDER)).rejects.toThrow(OrderStateError);
	});
});
