import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable, so each export is only as guarded
// as its own first line. These pin the capability each one names, and that a
// refused caller never reaches the service.

let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw new Error(`403: ${cap}`);
	return { id: 'acting-staff' };
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

const service = {
	listAgreements: vi.fn(async () => []),
	getAgreement: vi.fn(async () => ({ id: 'a1' })),
	createAgreement: vi.fn(async () => ({ id: 'a1' })),
	updateAgreement: vi.fn(async () => undefined),
	deleteAgreement: vi.fn(async () => undefined),
	nextDeadline: vi.fn(() => null)
};
vi.mock('$lib/server/agreement/agreement-service', () => service);

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: {} }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const p = handler(...a) as Promise<unknown> & { refresh?: () => Promise<void> };
			p.refresh = async () => undefined;
			return p;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (data: unknown) => unknown) => {
		const wrapped = (data: unknown) => handler(data);
		(wrapped as unknown as Record<string, unknown>).for = () => wrapped;
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'form' };
		return wrapped;
	},
	command: (h: unknown) => h
}));

const remote = (await import('./agreements.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const INPUT = { kind: 'grant', counterparty: 'OAC', title: 'Ops', status: 'prospect' };

const CASES: Array<{ name: string; cap: string; arg?: unknown; spy: ReturnType<typeof vi.fn> }> = [
	{ name: 'getAgreements', cap: 'agreement.read', arg: {}, spy: service.listAgreements },
	{ name: 'getAgreementDetail', cap: 'agreement.read', arg: 'a1', spy: service.getAgreement },
	{ name: 'createAgreement', cap: 'agreement.manage', arg: INPUT, spy: service.createAgreement },
	{
		name: 'updateAgreement',
		cap: 'agreement.manage',
		arg: { id: 'a1', ...INPUT },
		spy: service.updateAgreement
	},
	{
		name: 'deleteAgreement',
		cap: 'agreement.manage',
		arg: { id: 'a1' },
		spy: service.deleteAgreement
	}
];

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('agreements.remote guards', () => {
	for (const { name, cap, arg, spy } of CASES) {
		it(`${name} refuses a caller without ${cap} before the service`, async () => {
			held = new Set(cap === 'agreement.manage' ? ['agreement.read'] : []);
			await expect(remote[name](arg)).rejects.toThrow('403');
			expect(spy).not.toHaveBeenCalled();
		});

		it(`${name} reaches the service with ${cap}`, async () => {
			held = new Set(['agreement.read', cap]);
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
		});
	}
});

describe('createAgreement input', () => {
	it('stores blank optional fields as null, not empty strings', async () => {
		held = new Set(['agreement.read', 'agreement.manage']);
		await remote.createAgreement({ ...INPUT, tier: '', applyBy: '', notes: '' });
		expect(service.createAgreement).toHaveBeenCalledWith(
			expect.objectContaining({ tier: null, applyBy: null, notes: null, amountCents: null })
		);
	});
});
