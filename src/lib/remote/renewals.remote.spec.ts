import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable, so each export is only as guarded
// as its own first line. These pin the capability each one names, and that a
// refused caller never reaches the service.

let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw new Error(`403: ${cap}`);
	return { id: 'acting-staff' };
});
const listCapabilityHolders = vi.fn(async (_cap: string) => [
	{ id: 'u1', name: 'Ada', email: 'ada@example.com' }
]);
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

// The real guard is pinned in group-context.spec.ts; this one stands for
// "the renewals committee seat, or the capability" (#1602).
let onCommittee = false;
vi.mock('$lib/server/group/group-context', () => ({
	requireCommitteeCapability: async (cap: string) =>
		onCommittee
			? { user: { id: 'committee-member' }, group: null, role: 'member' }
			: { user: await requireCapability(cap), group: null, role: 'staff' },
	listCapabilityHolders: (cap: string) => listCapabilityHolders(cap)
}));

const service = {
	listRenewals: vi.fn(async () => []),
	getRenewal: vi.fn(async () => ({ id: 'r1' })),
	createRenewal: vi.fn(async () => ({ id: 'r1' })),
	updateRenewal: vi.fn(async () => undefined),
	deleteRenewal: vi.fn(async () => undefined),
	removeRenewalDocument: vi.fn(async () => undefined),
	uploadRenewalDocument: vi.fn(async () => undefined)
};
vi.mock('$lib/server/renewal/renewal-service', () => service);

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

const remote = (await import('./renewals.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const RENEWAL = { name: 'General liability', kind: 'insurance', expiresOn: '2027-01-31' };

const CASES: Array<{ name: string; cap: string; arg?: unknown; spy: ReturnType<typeof vi.fn> }> = [
	{ name: 'getRenewals', cap: 'renewal.read', arg: undefined, spy: service.listRenewals },
	{ name: 'getRenewalDetail', cap: 'renewal.read', arg: 'r1', spy: service.getRenewal },
	{ name: 'createRenewal', cap: 'renewal.manage', arg: RENEWAL, spy: service.createRenewal },
	{
		name: 'updateRenewal',
		cap: 'renewal.manage',
		arg: { id: 'r1', ...RENEWAL },
		spy: service.updateRenewal
	},
	{ name: 'deleteRenewal', cap: 'renewal.manage', arg: { id: 'r1' }, spy: service.deleteRenewal },
	{
		name: 'removeRenewalDocument',
		cap: 'renewal.manage',
		arg: { id: 'r1', attachmentId: 'att-1' },
		spy: service.removeRenewalDocument
	},
	{
		name: 'uploadRenewalDocument',
		cap: 'renewal.manage',
		arg: { id: 'r1', file: new File(['%PDF'], 'c.pdf', { type: 'application/pdf' }) },
		spy: service.uploadRenewalDocument
	}
];

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
	onCommittee = false;
});

describe('renewals.remote guards', () => {
	for (const { name, cap, arg, spy } of CASES) {
		it(`${name} admits a committee member holding no position`, async () => {
			onCommittee = true;
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
			expect(requireCapability).not.toHaveBeenCalled();
		});

		it(`${name} refuses a caller without ${cap} before the service`, async () => {
			held = new Set(cap === 'renewal.manage' ? ['renewal.read'] : []);
			await expect(remote[name](arg)).rejects.toThrow('403');
			expect(spy).not.toHaveBeenCalled();
		});

		it(`${name} reaches the service with ${cap}`, async () => {
			held = new Set(['renewal.read', cap]);
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
		});
	}
});

describe('renewal input', () => {
	it('stores blank optional fields as null, not empty strings', async () => {
		held = new Set(['renewal.read', 'renewal.manage']);
		await remote.createRenewal({ ...RENEWAL, issuer: '', reference: '', responsibleUserId: '' });
		expect(service.createRenewal).toHaveBeenCalledWith(
			expect.objectContaining({
				issuer: null,
				reference: null,
				responsibleUserId: null,
				notes: null
			})
		);
	});

	it('offers only renewal managers, seat included, as the responsible person', async () => {
		held = new Set(['renewal.read']);
		const out = (await remote.getRenewals()) as { assignees: unknown[] };
		expect(listCapabilityHolders).toHaveBeenCalledWith('renewal.manage');
		expect(out.assignees).toEqual([{ id: 'u1', name: 'Ada' }]);
	});
});
