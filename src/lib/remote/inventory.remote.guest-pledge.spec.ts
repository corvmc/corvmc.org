import { describe, it, expect, vi, beforeEach } from 'vitest';

// A non-member's wishlist pledge (#1565): Turnstile first, a per-address rate
// limit second, and only then a pending pledge that the service emails about.

const turnstileOk = vi.hoisted(() => ({ value: true }));
vi.mock('$lib/server/turnstile', () => ({ verifyTurnstile: vi.fn(async () => turnstileOk.value) }));
const rateOk = vi.hoisted(() => ({ value: true }));
vi.mock('$lib/server/rate-limit', () => ({
	allowRateLimited: vi.fn(async () => rateOk.value)
}));
const pledges = vi.hoisted(() => ({
	startGuestPledge: vi.fn(async () => undefined),
	confirmGuestPledge: vi.fn(async () => ({ status: 'confirmed' })),
	getGuestPledge: vi.fn(async () => null),
	fulfilPledges: vi.fn(),
	listOpenPledgesForStaff: vi.fn(),
	pledgeEntry: vi.fn(),
	releasePledge: vi.fn()
}));
vi.mock('$lib/server/inventory/pledge-service', () => pledges);
vi.mock('$lib/server/inventory/wishlist-service', () => ({
	getDonationWishlist: vi.fn(),
	isOnWishlist: vi.fn(async () => true)
}));

vi.mock('$lib/server/inventory/item-service', () => ({
	createItem: vi.fn(),
	updateItem: vi.fn(),
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
	recordAcquisition: vi.fn(),
	consumeStock: vi.fn(),
	adjustStock: vi.fn()
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
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: vi.fn(() => ({ id: 'user-1' })),
	requireCapabilityOrOwner: vi.fn(async () => 'staff'),
	isStaff: vi.fn(async () => true)
}));

vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: undefined },
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

// `issue.turnstileToken(msg)` is how a handler names the failing field.
const issue = new Proxy({}, { get: () => (message: string) => ({ message }) });
const payload = {
	subjectType: 'suggestion',
	subjectId: 's-1',
	name: 'Robin Tern',
	email: 'robin@example.com',
	turnstileToken: 'tok'
};

beforeEach(() => {
	vi.clearAllMocks();
	turnstileOk.value = true;
	rateOk.value = true;
});

describe('pledgeWishlistAsGuest', () => {
	it('starts a pending pledge under the guest name and email', async () => {
		await inventory.pledgeWishlistAsGuest(payload, issue);
		expect(pledges.startGuestPledge).toHaveBeenCalledWith({
			subjectType: 'suggestion',
			subjectId: 's-1',
			name: 'Robin Tern',
			email: 'robin@example.com'
		});
	});

	it('refuses a failed Turnstile check before anything is written or sent', async () => {
		turnstileOk.value = false;
		await expect(inventory.pledgeWishlistAsGuest(payload, issue)).rejects.toBeDefined();
		expect(pledges.startGuestPledge).not.toHaveBeenCalled();
	});

	it('refuses an address that has asked too often', async () => {
		rateOk.value = false;
		await expect(inventory.pledgeWishlistAsGuest(payload, issue)).rejects.toMatchObject({
			status: 429
		});
		expect(pledges.startGuestPledge).not.toHaveBeenCalled();
	});
});

describe('confirmWishlistPledge', () => {
	it('spends the token through the service', async () => {
		await expect(inventory.confirmWishlistPledge({ token: 'abc' })).resolves.toEqual({
			status: 'confirmed'
		});
		expect(pledges.confirmGuestPledge).toHaveBeenCalledWith('abc');
	});
});
