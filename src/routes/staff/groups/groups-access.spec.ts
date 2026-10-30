import { describe, it, expect, vi, beforeEach } from 'vitest';

// Groups shows each staffer the views their capabilities allow (#2086).
let held: string[] = [];
vi.mock('$lib/server/authorization', () => ({
	can: async (cap: string) => held.includes(cap)
}));
let kind: string | null = null;
vi.mock('$lib/server/group/group-service', () => ({
	getGroupDetail: async (id: string) => (kind ? { id, kind } : null)
}));

const groups = await import('./+page.server');
const record = await import('./[id]/+page.server');
const oldBands = await import('../bands/+page');
const oldClubs = await import('../clubs/+page');
const oldCommittees = await import('../committees/+page');
const oldBand = await import('../bands/[id]/+page');
const oldClub = await import('../clubs/[id]/+page');
const oldCommittee = await import('../committees/[id]/+page');

type Load = (e: unknown) => unknown;
const run = async (
	load: unknown,
	{ url = 'http://x/', params = {}, locals = { user: { id: 'usr-1' } } as object } = {}
) => (load as Load)({ locals, url: new URL(url), params, request: new Request(url) });

beforeEach(() => {
	held = [];
	kind = null;
});

describe('/staff/groups', () => {
	it('shows Bands to a band.read holder', async () => {
		held = ['band.read', 'group.read'];
		await expect(run(groups.load)).resolves.toBeUndefined();
	});

	it.each([
		[['group.read', 'committee.reviewApplications'], '/staff/groups/clubs'],
		[['committee.reviewApplications'], '/staff/groups/committees']
	])('sends a staffer holding %j to %s', async (caps, location) => {
		held = caps;
		await expect(run(groups.load)).rejects.toMatchObject({ status: 307, location });
	});
});

describe('/staff/groups/[id]', () => {
	it('names the kind to render', async () => {
		kind = 'committee';
		await expect(run(record.load, { params: { id: 'g-1' } })).resolves.toEqual({
			kind: 'committee'
		});
	});

	it('404s an unknown group', async () => {
		await expect(run(record.load, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
	});
});

describe('old addresses', () => {
	it.each([
		[oldBands.load, 'http://x/staff/bands?q=x', '/staff/groups?q=x'],
		[oldClubs.load, 'http://x/staff/clubs', '/staff/groups/clubs'],
		[oldCommittees.load, 'http://x/staff/committees', '/staff/groups/committees'],
		[oldBand.load, 'http://x/staff/bands/g-1', '/staff/groups/g-1'],
		[oldClub.load, 'http://x/staff/clubs/g-1', '/staff/groups/g-1'],
		[oldCommittee.load, 'http://x/staff/committees/g-1', '/staff/groups/g-1']
	])('308s %#', async (load, url, location) => {
		await expect(run(load, { url, params: { id: 'g-1' } })).rejects.toMatchObject({
			status: 308,
			location
		});
	});
});
