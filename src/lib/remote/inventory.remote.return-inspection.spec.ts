import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2266: the return form's schema has to carry the return-end inspection
// through to `returnLoan`. The harness applies the real schema before the
// handler, as in inventory.remote.number-fields.spec.ts.

const returnLoan = vi.fn(async () => undefined);
const createItemService = vi.fn(async () => ({ id: 'it-1' }));
const updateItem = vi.fn(async () => undefined);
const requestLoan = vi.fn(async () => ({ id: 'loan-1' }));
const recordAcquisition = vi.fn(async () => ({ id: 'acq-1' }));
const consumeStock = vi.fn(async () => ({ id: 'mv-1' }));
const adjustStock = vi.fn(async () => ({ id: 'mv-2' }));

vi.mock('$lib/server/inventory/item-service', () => ({
	createItem: createItemService,
	updateItem,
	getItemById: vi.fn(),
	listCategories: vi.fn(),
	listItems: vi.fn(),
	listLocations: vi.fn(),
	createCategory: vi.fn(),
	createLocation: vi.fn(),
	updateCategory: vi.fn(),
	deleteCategory: vi.fn(),
	softDeleteItem: vi.fn(),
	restoreItem: vi.fn()
}));

vi.mock('$lib/server/inventory/asset-service', () => ({
	bindAssetTag: vi.fn(),
	createAsset: vi.fn(),
	getAssetById: vi.fn(),
	getAssetByTag: vi.fn(),
	listAssets: vi.fn(),
	listAvailableAssets: vi.fn(),
	setAssetStatus: vi.fn(),
	updateAsset: vi.fn()
}));

vi.mock('$lib/server/inventory/stock-service', () => ({
	listLowStock: vi.fn(),
	listMovements: vi.fn()
}));

vi.mock('$lib/server/inventory/acquisition-service', () => ({
	recordAcquisition,
	consumeStock,
	adjustStock
}));

vi.mock('$lib/server/inventory/loan-service', () => ({
	getLoanById: vi.fn(),
	getLoanHistory: vi.fn(),
	scheduleLoan: vi.fn(),
	checkoutLoan: vi.fn(),
	requestLoan,
	cancelLoan: vi.fn(),
	returnLoan,
	listLoans: vi.fn(),
	listUserLoans: vi.fn()
}));

vi.mock('$lib/server/authorization', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: vi.fn(() => ({ id: 'user-1' })),
	requireCapabilityOrOwner: vi.fn(async () => 'staff'),
	isStaff: vi.fn(async () => true)
}));

vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'user-1' } },
		request: { headers: new Headers() }
	}),
	query: () => {
		const stub = (() => ({ refresh: async () => undefined })) as unknown as Record<string, unknown>;
		stub.__ = { type: 'query' };
		return stub;
	},
	command: (...args: unknown[]) => wrap(args),
	// Unlike the other remote specs, this mock *applies* the schema before
	// calling the handler — the bug under test is a schema/payload mismatch, so
	// skipping validation would skip the regression entirely.
	form: (...args: unknown[]) => wrap(args)
}));

function wrap(args: unknown[]) {
	const schema = args.length > 1 ? (args[0] as { parse: (v: unknown) => unknown }) : null;
	const handler = (args.length > 1 ? args[1] : args[0]) as (
		data: unknown,
		issue: unknown
	) => Promise<unknown>;
	const fn = (async (data: unknown, issue: unknown) => {
		const parsed = schema && typeof schema.parse === 'function' ? schema.parse(data) : data;
		return handler(parsed, issue);
	}) as Record<string, unknown> & ((data: unknown, issue: unknown) => Promise<unknown>);
	fn.__ = { type: 'form' };
	fn.for = () => fn;
	return fn;
}

const inventory = (await import('./inventory.remote')) as unknown as Record<
	string,
	(data: unknown, issue?: unknown) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('returnLoan carries the inspection', () => {
	it('passes the condition and a raised flag', async () => {
		await inventory.returnLoan({
			id: 'loan-1',
			condition: 'poor',
			flagNote: 'Input jack crackles',
			flagBlocksUse: true
		});

		expect(returnLoan).toHaveBeenCalledWith('loan-1', undefined, {
			actorId: 'user-1',
			condition: 'poor',
			flags: [{ note: 'Input jack crackles', blocksUse: true }]
		});
	});

	it('passes neither when the inspection is left blank', async () => {
		await inventory.returnLoan({ id: 'loan-1', condition: '', flagNote: '  ' });

		expect(returnLoan).toHaveBeenCalledWith('loan-1', undefined, {
			actorId: 'user-1',
			condition: undefined,
			flags: undefined
		});
	});

	it('raises a flag that does not block use when the box is unticked', async () => {
		await inventory.returnLoan({ id: 'loan-1', flagNote: 'Scuffed corner' });

		expect(returnLoan).toHaveBeenCalledWith(
			'loan-1',
			undefined,
			expect.objectContaining({ flags: [{ note: 'Scuffed corner', blocksUse: false }] })
		);
	});
});
