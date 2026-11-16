import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bands, clubs and committees are listed apart (#3027); every Groups address lands on its kind.
let kind: string | null = null;
vi.mock('#lib/server/group/group-service.js', () => ({
	getGroupDetail: async (id: string) => (kind ? { id, kind } : null)
}));

const groups = await import('./+page');
const groupBands = await import('./bands/+page');
const groupClubs = await import('./clubs/+page');
const groupCommittees = await import('./committees/+page');
const acts = await import('../bands/acts/+page');
const oldRecord = await import('./[id]/+page.server');
const bandRecord = await import('../bands/[id]/+page.server');
const clubRecord = await import('../clubs/[id]/+page.server');
const committeeRecord = await import('../committees/[id]/+page.server');

type Load = (e: unknown) => unknown;
const run = async (load: unknown, { url = 'http://x/', params = {} } = {}) =>
	(load as Load)({ url: new URL(url), params, request: new Request(url) });

beforeEach(() => {
	kind = null;
});

describe('old Groups addresses', () => {
	// Each target carries `via`: every kind's list once 308'd to `/staff/groups` (#2961).
	it.each([
		[groups.load, 'http://x/staff/groups', '/staff/bands?via=groups'],
		[groups.load, 'http://x/staff/groups?via=groups', '/staff/bands?via=groups'],
		[groups.load, 'http://x/staff/groups?kind=club&q=x', '/staff/clubs?q=x&via=groups'],
		[groups.load, 'http://x/staff/groups?kind=committee', '/staff/committees?via=groups'],
		[groupBands.load, 'http://x/staff/groups/bands?q=x', '/staff/bands?q=x&via=groups'],
		[groupClubs.load, 'http://x/staff/groups/clubs', '/staff/clubs?via=groups'],
		[groupCommittees.load, 'http://x/staff/groups/committees', '/staff/committees?via=groups'],
		[acts.load, 'http://x/staff/bands/acts', '/staff/contacts?role=performer']
	])('308s %#', async (load, url, location) => {
		await expect(run(load, { url })).rejects.toMatchObject({ status: 308, location });
	});

	it.each([
		['band', '/staff/bands/g-1?via=groups'],
		['club', '/staff/clubs/g-1?via=groups'],
		['committee', '/staff/committees/g-1?via=groups']
	])('308s a %s record to its own list', async (k, location) => {
		kind = k;
		await expect(
			run(oldRecord.load, { url: 'http://x/staff/groups/g-1', params: { id: 'g-1' } })
		).rejects.toMatchObject({ status: 308, location });
	});

	it('404s an unknown group', async () => {
		await expect(run(oldRecord.load, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
	});
});

describe('record pages', () => {
	it.each([
		[bandRecord.load, 'band'],
		[clubRecord.load, 'club'],
		[committeeRecord.load, 'committee']
	])('renders its own kind %#', async (load, k) => {
		kind = k;
		await expect(run(load, { params: { id: 'g-1' } })).resolves.toBeUndefined();
	});

	it("sends another kind's id to that kind's record", async () => {
		kind = 'committee';
		await expect(run(clubRecord.load, { params: { id: 'g-1' } })).rejects.toMatchObject({
			status: 307,
			location: '/staff/committees/g-1'
		});
	});

	it('404s an unknown group', async () => {
		await expect(run(bandRecord.load, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
	});
});
