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
	listSponsors: vi.fn(async () => []),
	getSponsor: vi.fn(async () => ({ id: 's1' })),
	createSponsor: vi.fn(async () => ({ id: 's1' })),
	updateSponsor: vi.fn(async () => undefined),
	deleteSponsor: vi.fn(async () => undefined),
	createSponsorship: vi.fn(async () => ({ id: 'p1' })),
	updateSponsorship: vi.fn(async () => undefined),
	deleteSponsorship: vi.fn(async () => undefined)
};
vi.mock('$lib/server/sponsor/sponsor-service', () => service);

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

const remote = (await import('./sponsors.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const SPONSOR = { name: 'Troubadour Music' };
const SHIP = { sponsorId: 's1', title: 'Season', status: 'active' };

const CASES: Array<{ name: string; cap: string; arg?: unknown; spy: ReturnType<typeof vi.fn> }> = [
	{ name: 'getSponsors', cap: 'sponsor.read', arg: undefined, spy: service.listSponsors },
	{ name: 'getSponsorDetail', cap: 'sponsor.read', arg: 's1', spy: service.getSponsor },
	{ name: 'createSponsor', cap: 'sponsor.manage', arg: SPONSOR, spy: service.createSponsor },
	{
		name: 'updateSponsor',
		cap: 'sponsor.manage',
		arg: { id: 's1', ...SPONSOR },
		spy: service.updateSponsor
	},
	{ name: 'deleteSponsor', cap: 'sponsor.manage', arg: { id: 's1' }, spy: service.deleteSponsor },
	{ name: 'createSponsorship', cap: 'sponsor.manage', arg: SHIP, spy: service.createSponsorship },
	{
		name: 'updateSponsorship',
		cap: 'sponsor.manage',
		arg: { id: 'p1', ...SHIP },
		spy: service.updateSponsorship
	},
	{
		name: 'deleteSponsorship',
		cap: 'sponsor.manage',
		arg: { id: 'p1', sponsorId: 's1' },
		spy: service.deleteSponsorship
	}
];

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('sponsors.remote guards', () => {
	for (const { name, cap, arg, spy } of CASES) {
		it(`${name} refuses a caller without ${cap} before the service`, async () => {
			held = new Set(cap === 'sponsor.manage' ? ['sponsor.read'] : []);
			await expect(remote[name](arg)).rejects.toThrow('403');
			expect(spy).not.toHaveBeenCalled();
		});

		it(`${name} reaches the service with ${cap}`, async () => {
			held = new Set(['sponsor.read', cap]);
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
		});
	}
});

describe('sponsor input', () => {
	it('stores blank optional fields as null, not empty strings', async () => {
		held = new Set(['sponsor.read', 'sponsor.manage']);
		await remote.createSponsor({ ...SPONSOR, website: '', notes: '' });
		expect(service.createSponsor).toHaveBeenCalledWith(
			expect.objectContaining({ website: null, notes: null, contactEmail: null })
		);
		await remote.createSponsorship({ ...SHIP, tier: '', endsOn: '' });
		expect(service.createSponsorship).toHaveBeenCalledWith(
			expect.objectContaining({ tier: null, endsOn: null, amountCents: null })
		);
	});
});
