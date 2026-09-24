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

// The real guard is pinned in group-context.spec.ts; this one stands for
// "a Development committee seat, or the capability" (#1578).
let onCommittee = false;
vi.mock('$lib/server/group/group-context', () => ({
	requireCommitteeCapability: async (cap: string) =>
		onCommittee
			? { user: { id: 'committee-member' }, group: null, role: 'member' }
			: { user: await requireCapability(cap), group: null, role: 'staff' }
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

const credits = {
	listPlacementsForSponsor: vi.fn(async () => []),
	sponsorLogoKey: vi.fn(async () => null),
	placeSponsorship: vi.fn(async () => undefined),
	removePlacement: vi.fn(async () => undefined),
	setSponsorLogo: vi.fn(async () => undefined),
	removeSponsorLogo: vi.fn(async () => undefined)
};
vi.mock('$lib/server/sponsor/credit-service', () => credits);
vi.mock('$lib/server/storage', () => ({
	validateUpload: () => null,
	resolveImageUrl: (k: string | null) => (k ? `https://img/${k}` : null)
}));

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
vi.mock('@sveltejs/kit', async (orig) => ({
	...(await orig<object>()),
	invalid: (msg: unknown) => {
		throw new Error(`invalid: ${String(msg)}`);
	}
}));

const remote = (await import('./sponsors.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const SPONSOR = { name: 'Troubadour Music' };
const SHIP = { sponsorId: 's1', title: 'Season', status: 'active' };
const PLACE = {
	sponsorId: 's1',
	sponsorshipId: 'p1',
	eventId: 'e1',
	onEventPage: true,
	inCampaign: false
};
const LOGO = { sponsorId: 's1', logo: new File(['x'], 'logo.png', { type: 'image/png' }) };

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
	},
	{ name: 'placeSponsorship', cap: 'sponsor.manage', arg: PLACE, spy: credits.placeSponsorship },
	{
		name: 'removePlacement',
		cap: 'sponsor.manage',
		arg: { id: 'x1', sponsorId: 's1' },
		spy: credits.removePlacement
	},
	{ name: 'setSponsorLogo', cap: 'sponsor.manage', arg: LOGO, spy: credits.setSponsorLogo },
	{
		name: 'removeSponsorLogo',
		cap: 'sponsor.manage',
		arg: { sponsorId: 's1' },
		spy: credits.removeSponsorLogo
	}
];

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
	onCommittee = false;
});

describe('sponsors.remote guards', () => {
	for (const { name, cap, arg, spy } of CASES) {
		it(`${name} admits a Development committee member holding no position`, async () => {
			onCommittee = true;
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
			expect(requireCapability).not.toHaveBeenCalled();
		});

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

describe('sponsor detail', () => {
	it("carries the sponsor's placements and a public logo URL", async () => {
		held = new Set(['sponsor.read']);
		credits.sponsorLogoKey.mockResolvedValueOnce('sponsors/logos/s1.png' as never);
		const detail = (await remote.getSponsorDetail('s1')) as Record<string, unknown>;
		expect(detail.logoUrl).toBe('https://img/sponsors/logos/s1.png');
		expect(detail.placements).toEqual([]);
	});
});
