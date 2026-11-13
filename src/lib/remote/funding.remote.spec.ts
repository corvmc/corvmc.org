import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Funding page reads two modules. Each half is loaded only for a viewer
// holding that module's `read`, the pickers only for one who may create, and a
// viewer with neither is refused before any service runs.

let held = new Set<string>();
vi.mock('#lib/server/authorization.js', () => ({
	can: async (cap: string) => held.has(cap),
	requireCapability: async (cap: string) => {
		if (!held.has(cap)) throw new Error(`403: ${cap}`);
		return { id: 'acting-staff' };
	}
}));

const listFunding = vi.fn(async () => []);
vi.mock('#lib/server/development/funding-service.js', () => ({ listFunding }));
const listFundableProjects = vi.fn(async () => []);
vi.mock('#lib/server/development/funding-project.js', () => ({ listFundableProjects }));
const listFunders = vi.fn(async () => []);
vi.mock('#lib/server/grant/funder-service.js', () => ({ listFunders }));
const listOrganizations = vi.fn(async () => []);
vi.mock('#lib/server/party/organization-service.js', () => ({ listOrganizations }));

vi.mock('$app/server', () => ({
	query: (_schema: unknown, handler: (arg: unknown) => unknown) =>
		Object.assign((arg: unknown) => handler(arg), { __: { type: 'query' } })
}));

const { getFunding } = (await import('./funding.remote')) as unknown as {
	getFunding: (arg: { includeClosed?: boolean }) => Promise<Record<string, unknown>>;
};

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('getFunding', () => {
	it('refuses a viewer who can read neither grants nor sponsorships', async () => {
		await expect(getFunding({})).rejects.toThrow('403');
		expect(listFunding).not.toHaveBeenCalled();
	});

	it('loads only the half the viewer may read, and no pickers for a reader', async () => {
		held = new Set(['sponsor.read']);
		const page = await getFunding({ includeClosed: true });
		expect(listFunding).toHaveBeenCalledWith(
			expect.objectContaining({ grants: false, sponsors: true, includeClosed: true })
		);
		expect(page.canCreate).toEqual({ grants: false, sponsors: false });
		expect(
			[listFunders, listOrganizations, listFundableProjects].map((f) => f.mock.calls.length)
		).toEqual([0, 0, 0]);
	});

	it('loads the funder picker for a grant manager and the sponsor picker for a sponsor manager', async () => {
		held = new Set(['grant.read', 'grant.manage']);
		await getFunding({});
		expect(listFunders).toHaveBeenCalled();
		expect(listOrganizations).not.toHaveBeenCalled();
		expect(listFundableProjects).toHaveBeenCalled();
	});
});
