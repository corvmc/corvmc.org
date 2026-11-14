import { describe, it, expect, vi, beforeEach } from 'vitest';

// Groups shows each staffer the kinds their capabilities allow (#2086, #2765).
let held: string[] = [];
vi.mock('#lib/server/authorization.js', () => ({
	can: async (cap: string) => held.includes(cap)
}));
let kind: string | null = null;
vi.mock('#lib/server/group/group-service.js', () => ({
	getGroupDetail: async (id: string) => (kind ? { id, kind } : null)
}));

const groups = await import('./+page.server');
const groupBands = await import('./bands/+page');
const groupClubs = await import('./clubs/+page');
const groupCommittees = await import('./committees/+page');
const acts = await import('../bands/acts/+page');
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
		[['group.read', 'committee.reviewApplications'], '/staff/groups?kind=club'],
		[['committee.reviewApplications'], '/staff/groups?kind=committee']
	])('sends a staffer holding %j to %s', async (caps, location) => {
		held = caps;
		await expect(run(groups.load)).rejects.toMatchObject({ status: 307, location });
	});

	it('leaves a kind filter to its own remotes', async () => {
		held = ['group.read'];
		await expect(
			run(groups.load, { url: 'http://x/staff/groups?kind=club' })
		).resolves.toBeUndefined();
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
		[groupBands.load, 'http://x/staff/groups/bands?q=x', '/staff/groups?q=x'],
		[groupClubs.load, 'http://x/staff/groups/clubs?q=x', '/staff/groups?kind=club&q=x'],
		[groupCommittees.load, 'http://x/staff/groups/committees', '/staff/groups?kind=committee'],
		[oldBands.load, 'http://x/staff/bands?q=x', '/staff/groups?q=x'],
		[oldClubs.load, 'http://x/staff/clubs', '/staff/groups?kind=club'],
		[oldCommittees.load, 'http://x/staff/committees', '/staff/groups?kind=committee'],
		[acts.load, 'http://x/staff/bands/acts', '/staff/contacts?role=performer'],
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
