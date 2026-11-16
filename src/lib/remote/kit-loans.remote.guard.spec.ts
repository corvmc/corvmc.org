import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Kit loans are loans: every remote checks `inventory.manageLoans` before the service (#2725). */

const requireCapability = vi.fn<(cap: string) => Promise<unknown>>(async () => {
	throw new Error('403');
});
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

const service = vi.hoisted(() => ({
	checkoutKit: vi.fn(),
	getKitLoan: vi.fn(),
	listKitLoans: vi.fn(),
	returnKit: vi.fn()
}));
vi.mock('#lib/server/inventory/kit-loan-service.js', () => service);
vi.mock('$app/server', () => {
	const mark = (fn: unknown, type: string) =>
		Object.assign(fn as object, { __: { type }, for: () => fn });
	return {
		query: (...args: unknown[]) => mark(typeof args[0] === 'function' ? args[0] : args[1], 'query'),
		form: (_schema: unknown, handler: unknown) => mark(handler, 'form'),
		command: (handler: unknown) => mark(handler, 'command')
	};
});

const remote = (await import('./kit-loans.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const CALLS: [string, unknown?][] = [
	['getKitLoans'],
	['getKitLoanDetail', 'kit-1'],
	['checkOutKit', { locationId: 'loc-1', userId: 'm' }],
	['checkInKit', { kitLoanId: 'kit-1', returnedLoanIds: [] }]
];

beforeEach(() => vi.clearAllMocks());

describe('kit loan remotes', () => {
	it.each(CALLS)('%s refuses without inventory.manageLoans', async (name, arg) => {
		await expect(remote[name](arg)).rejects.toThrow('403');
		expect(requireCapability).toHaveBeenCalledWith('inventory.manageLoans');
		for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
	});
});
