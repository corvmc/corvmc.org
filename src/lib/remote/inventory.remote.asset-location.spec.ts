import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: saving a unit erased where it was.
//
// The unit form carried no location field, so every Save submitted no
// `locationId`. `editAsset` then coerced that absence with `|| null`, and
// `updateAsset` skips `undefined` but *writes* `null` — so editing a serial
// number silently moved the unit to Unassigned. Proven against a real database
// during the pre-stocktake QA pass: a unit in "Main room" was filed under
// Unassigned by typing a serial and pressing Save.
//
// Absent and empty are different questions. `undefined` is "the form did not
// ask about location"; `''` is "the operator picked Unassigned". Only the second
// may clear the column, and the form now always asks.
//
// Like `inventory.remote.number-fields.spec.ts`, the `form()` mock here *applies*
// the schema before calling the handler — the bug lives in the gap between what
// the payload carries and what the handler does with it, so skipping validation
// would skip the regression.

const updateAsset = vi.fn(async () => undefined);

vi.mock('$lib/server/inventory/item-service', () => ({
	createItem: vi.fn(),
	updateItem: vi.fn(),
	getItemById: vi.fn(),
	listCategories: vi.fn(),
	listItems: vi.fn(),
	listLocations: vi.fn(),
	listLocationsWithCounts: vi.fn(),
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
	listForm8282Obligations: vi.fn(),
	resolveForm8282: vi.fn(),
	setAssetStatus: vi.fn(),
	updateAsset
}));

vi.mock('$lib/server/inventory/stock-service', () => ({
	listLowStock: vi.fn(),
	listMovements: vi.fn()
}));

vi.mock('$lib/server/inventory/acquisition-service', () => ({
	acknowledgeForm8283: vi.fn(),
	adjustStock: vi.fn(),
	consumeStock: vi.fn(),
	getAcquisitionById: vi.fn(),
	listAcquisitions: vi.fn(),
	markReimbursed: vi.fn(),
	recordAcquisition: vi.fn(),
	spendByCategory: vi.fn(),
	updateAcquisition: vi.fn()
}));

vi.mock('$lib/server/inventory/form-8282', () => ({ form8282Status: vi.fn() }));

vi.mock('$lib/server/inventory/resources-service', () => ({
	linkArticle: vi.fn(),
	listItemResources: vi.fn(),
	listLinkableArticles: vi.fn(),
	listMemberItemResources: vi.fn(),
	reportDamage: vi.fn(),
	unlinkArticle: vi.fn()
}));

vi.mock('$lib/server/inventory/loan-service', () => ({
	getLoanById: vi.fn(),
	getLoanHistory: vi.fn(),
	scheduleLoan: vi.fn(),
	checkoutLoan: vi.fn(),
	requestLoan: vi.fn(),
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

describe('editAsset and the unit location', () => {
	it('leaves the location alone when the form did not send one', async () => {
		await inventory.editAsset({ id: 'asset-1', serialNumber: 'SN-1' });

		expect(updateAsset).toHaveBeenCalledTimes(1);
		const [, patch] = updateAsset.mock.calls[0] as unknown as [string, Record<string, unknown>];

		// `undefined`, not `null`. `updateAsset` skips undefined and writes null,
		// so this single distinction is the whole bug.
		expect(patch.locationId).toBeUndefined();
		expect('locationId' in patch && patch.locationId === null).toBe(false);
	});

	it('clears the location when the operator picks Unassigned', async () => {
		await inventory.editAsset({ id: 'asset-1', serialNumber: 'SN-1', locationId: '' });

		const [, patch] = updateAsset.mock.calls[0] as unknown as [string, Record<string, unknown>];
		expect(patch.locationId).toBeNull();
	});

	it('sets the location when one is chosen', async () => {
		await inventory.editAsset({ id: 'asset-1', locationId: 'loc-9' });

		const [, patch] = updateAsset.mock.calls[0] as unknown as [string, Record<string, unknown>];
		expect(patch.locationId).toBe('loc-9');
	});
});
