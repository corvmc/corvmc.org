import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: a `<Field field={fields.X} type="number">` registers through
// SvelteKit's `field.as('number')`, which prefixes the submitted name with `n:`.
// `convert_formdata` then runs the value through `parseFloat`, so the remote
// handler receives a *number*. Schemas that declared those fields as
// `z.string()` rejected every submit with "expected string, received number",
// which made Add Equipment, the equipment edit form, and the staff Create Loan
// modal impossible to submit.
//
// These drive the real schemas declared in equipment.remote.ts with the payload
// SvelteKit's `convert_formdata` produces. The framework's own `n:` -> number
// conversion is SvelteKit's contract, not ours, so it is not re-tested here.

const createEquipmentService = vi.fn(async () => ({ id: 'eq-1' }));
const updateEquipment = vi.fn(async () => undefined);
const requestLoan = vi.fn(async () => ({ id: 'loan-1' }));

vi.mock('$lib/server/equipment/equipment-service', () => ({
	createEquipment: createEquipmentService,
	updateEquipment,
	getEquipmentById: vi.fn(),
	listCategories: vi.fn(),
	listEquipment: vi.fn(),
	createCategory: vi.fn(),
	updateCategory: vi.fn(),
	deleteCategory: vi.fn(),
	softDeleteEquipment: vi.fn(),
	restoreEquipment: vi.fn()
}));

vi.mock('$lib/server/equipment/loan-service', () => ({
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

const equipment = (await import('./equipment.remote')) as unknown as Record<
	string,
	(data: unknown, issue?: unknown) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('number fields submitted through field.as("number")', () => {
	it('createEquipment accepts numeric quantities', async () => {
		await equipment.createEquipment({
			name: 'SM58',
			categoryId: 'cat-1',
			condition: 'good',
			totalQuantity: 3,
			outOfOrderQuantity: 1
		});

		expect(createEquipmentService).toHaveBeenCalledWith(
			expect.objectContaining({ totalQuantity: 3, outOfOrderQuantity: 1 })
		);
	});

	it('createEquipment falls back to defaults when the quantity inputs are left empty', async () => {
		// An empty `<input type="number">` submits as `undefined`, not `''`.
		await equipment.createEquipment({
			name: 'SM58',
			categoryId: 'cat-1',
			condition: 'good',
			totalQuantity: undefined,
			outOfOrderQuantity: undefined
		});

		expect(createEquipmentService).toHaveBeenCalledWith(
			expect.objectContaining({ totalQuantity: 1, outOfOrderQuantity: 0 })
		);
	});

	it('editEquipment accepts numeric quantities, including zero', async () => {
		await equipment.editEquipment({
			id: 'eq-1',
			name: 'SM58',
			totalQuantity: 4,
			outOfOrderQuantity: 0
		});

		expect(updateEquipment).toHaveBeenCalledWith(
			'eq-1',
			expect.objectContaining({ totalQuantity: 4, outOfOrderQuantity: 0 })
		);
	});

	it('createLoan accepts a numeric quantity', async () => {
		await equipment.createLoan({
			userId: 'user-2',
			equipmentId: 'eq-1',
			quantity: 2,
			requestedPickupDate: '2026-09-01',
			estimatedReturnDate: '2026-09-08'
		});

		expect(requestLoan).toHaveBeenCalledWith('user-2', expect.objectContaining({ quantity: 2 }));
	});

	it('createLoan defaults the quantity when the input is left empty', async () => {
		await equipment.createLoan({
			userId: 'user-2',
			equipmentId: 'eq-1',
			quantity: undefined,
			requestedPickupDate: '2026-09-01',
			estimatedReturnDate: '2026-09-08'
		});

		expect(requestLoan).toHaveBeenCalledWith('user-2', expect.objectContaining({ quantity: 1 }));
	});
});
