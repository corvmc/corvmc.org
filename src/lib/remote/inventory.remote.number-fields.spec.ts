import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: a `<Field field={fields.X} type="number">` registers through
// SvelteKit's `field.as('number')`, which prefixes the submitted name with `n:`.
// `convert_formdata` then runs the value through `parseFloat`, so the remote
// handler receives a *number*. Schemas that declared those fields as
// `z.string()` rejected every submit with "expected string, received number",
// which made Add Equipment, the edit form, and the staff Create Loan modal
// impossible to submit.
//
// The rebuild moved the number fields — quantities now live on receiving,
// consumption and stocktake rather than on the catalog row — so the same trap
// is reachable in new places. These drive the real schemas declared in
// inventory.remote.ts with the payload SvelteKit's `convert_formdata` produces.

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
	returnLoan: vi.fn(),
	listLoans: vi.fn(),
	listUserLoans: vi.fn()
}));

vi.mock('$lib/server/authorization', () => ({
	requireStaff: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: vi.fn(() => ({ id: 'user-1' })),
	requireStaffOrOwner: vi.fn(async () => 'staff'),
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

describe('number fields submitted through field.as("number")', () => {
	it('createItem accepts numeric reorder settings', async () => {
		await inventory.createItem({
			name: 'XLR cable',
			categoryId: 'cat-1',
			kind: 'bulk',
			reorderPoint: 6,
			reorderQuantity: 12
		});

		expect(createItemService).toHaveBeenCalledWith(
			expect.objectContaining({ reorderPoint: 6, reorderQuantity: 12 })
		);
	});

	it('createItem accepts a reorder point of zero', async () => {
		// Zero is a legitimate par level — "tell me the moment we have none" —
		// and `z.number().min(0)` has to admit it where a truthiness check would
		// silently drop it.
		await inventory.createItem({
			name: 'Batteries',
			categoryId: 'cat-1',
			kind: 'bulk',
			reorderPoint: 0
		});

		expect(createItemService).toHaveBeenCalledWith(expect.objectContaining({ reorderPoint: 0 }));
	});

	it('createItem survives the reorder inputs being left empty', async () => {
		// An empty `<input type="number">` submits as `undefined`, not `''`.
		await inventory.createItem({
			name: 'Blues Deluxe',
			categoryId: 'cat-1',
			kind: 'serialized',
			reorderPoint: undefined,
			reorderQuantity: undefined
		});

		expect(createItemService).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Blues Deluxe' })
		);
	});

	it('editItem accepts numeric reorder settings, including zero', async () => {
		await inventory.editItem({ id: 'it-1', name: 'XLR cable', reorderPoint: 0 });

		expect(updateItem).toHaveBeenCalledWith('it-1', expect.objectContaining({ reorderPoint: 0 }));
	});

	it('receiveStock accepts a numeric quantity and unit value', async () => {
		await inventory.receiveStock({
			itemId: 'it-1',
			quantity: 20,
			kind: 'purchase',
			unitValueCents: 400
		});

		expect(recordAcquisition).toHaveBeenCalledWith(
			expect.objectContaining({
				lines: [expect.objectContaining({ quantity: 20, unitValueCents: 400 })]
			})
		);
	});

	it('receiveStock accepts a donation with no price on it', async () => {
		await inventory.receiveStock({
			itemId: 'it-1',
			quantity: 1,
			kind: 'donation',
			unitValueCents: undefined
		});

		expect(recordAcquisition).toHaveBeenCalledWith(expect.objectContaining({ kind: 'donation' }));
	});

	it('useStock accepts a numeric quantity', async () => {
		await inventory.useStock({ itemId: 'it-1', quantity: 3 });
		expect(consumeStock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
	});

	/**
	 * A stocktake correction is the one quantity that is legitimately negative,
	 * so the schema must not borrow the `min(1)` the others use.
	 */
	it('correctStock accepts a negative delta', async () => {
		await inventory.correctStock({ itemId: 'it-1', delta: -2, notes: 'stocktake' });
		expect(adjustStock).toHaveBeenCalledWith(expect.objectContaining({ delta: -2 }));
	});

	it('createLoan accepts a numeric quantity', async () => {
		await inventory.createLoan({
			userId: 'user-2',
			itemId: 'it-1',
			quantity: 2,
			requestedPickupDate: '2026-09-01',
			estimatedReturnDate: '2026-09-08'
		});

		expect(requestLoan).toHaveBeenCalledWith('user-2', expect.objectContaining({ quantity: 2 }));
	});

	it('createLoan defaults the quantity when the input is left empty', async () => {
		await inventory.createLoan({
			userId: 'user-2',
			itemId: 'it-1',
			quantity: undefined,
			requestedPickupDate: '2026-09-01',
			estimatedReturnDate: '2026-09-08'
		});

		expect(requestLoan).toHaveBeenCalledWith('user-2', expect.objectContaining({ quantity: 1 }));
	});
});
