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

const grants = {
	listGrants: vi.fn(async () => []),
	getGrant: vi.fn(async () => ({ id: 'g1' })),
	createGrant: vi.fn(async () => ({ id: 'g1' })),
	updateGrant: vi.fn(async () => undefined),
	deleteGrant: vi.fn(async () => undefined),
	addGrantReport: vi.fn(async () => undefined),
	updateGrantReport: vi.fn(async () => undefined),
	deleteGrantReport: vi.fn(async () => undefined)
};
vi.mock('$lib/server/grant/grant-service', () => grants);

const funders = {
	listFunders: vi.fn(async () => []),
	createFunder: vi.fn(async () => ({ id: 'f1' })),
	updateFunder: vi.fn(async () => undefined),
	deleteFunder: vi.fn(async () => undefined)
};
vi.mock('$lib/server/grant/funder-service', () => funders);

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

const remote = (await import('./grants.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const GRANT = { funderId: 'f1', title: 'Operating support', status: 'prospect' };
const FUNDER = { name: 'Oregon Arts Commission' };
const REPORT = { grantApplicationId: 'g1', title: 'Final report', dueOn: '2027-01-15' };

type Case = { name: string; cap: string; arg?: unknown; spy: ReturnType<typeof vi.fn> };
const CASES: Case[] = [
	{ name: 'getGrants', cap: 'grant.read', arg: {}, spy: grants.listGrants },
	{ name: 'getGrantDetail', cap: 'grant.read', arg: 'g1', spy: grants.getGrant },
	{ name: 'getFunders', cap: 'grant.read', arg: undefined, spy: funders.listFunders },
	{ name: 'createGrant', cap: 'grant.manage', arg: GRANT, spy: grants.createGrant },
	{
		name: 'updateGrant',
		cap: 'grant.manage',
		arg: { id: 'g1', ...GRANT },
		spy: grants.updateGrant
	},
	{ name: 'deleteGrant', cap: 'grant.manage', arg: { id: 'g1' }, spy: grants.deleteGrant },
	{ name: 'createFunder', cap: 'grant.manage', arg: FUNDER, spy: funders.createFunder },
	{
		name: 'updateFunder',
		cap: 'grant.manage',
		arg: { id: 'f1', ...FUNDER },
		spy: funders.updateFunder
	},
	{ name: 'deleteFunder', cap: 'grant.manage', arg: { id: 'f1' }, spy: funders.deleteFunder },
	{ name: 'addGrantReport', cap: 'grant.manage', arg: REPORT, spy: grants.addGrantReport },
	{
		name: 'updateGrantReport',
		cap: 'grant.manage',
		arg: { id: 'r1', ...REPORT },
		spy: grants.updateGrantReport
	},
	{
		name: 'deleteGrantReport',
		cap: 'grant.manage',
		arg: { id: 'r1', grantApplicationId: 'g1' },
		spy: grants.deleteGrantReport
	}
];

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('grants.remote guards', () => {
	for (const { name, cap, arg, spy } of CASES) {
		it(`${name} refuses a caller without ${cap} before the service`, async () => {
			held = new Set(cap === 'grant.manage' ? ['grant.read'] : []);
			await expect(remote[name](arg)).rejects.toThrow('403');
			expect(spy).not.toHaveBeenCalled();
		});

		it(`${name} reaches the service with ${cap}`, async () => {
			held = new Set(['grant.read', cap]);
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
		});
	}
});

describe('grant input', () => {
	it('stores blank optional fields as null, not empty strings', async () => {
		held = new Set(['grant.read', 'grant.manage']);
		await remote.createGrant({ ...GRANT, applyBy: '', notes: '' });
		expect(grants.createGrant).toHaveBeenCalledWith(
			expect.objectContaining({
				applyBy: null,
				notes: null,
				amountRequestedCents: null,
				amountAwardedCents: null
			})
		);
		await remote.addGrantReport({ ...REPORT, submittedOn: '' });
		expect(grants.addGrantReport).toHaveBeenCalledWith(
			expect.objectContaining({ submittedOn: null, notes: null })
		);
	});
});
