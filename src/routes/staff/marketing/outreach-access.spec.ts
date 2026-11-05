import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAudienceList, getCampaigns } from '#lib/remote/marketing.remote.js';
import { filterNavSections, staffNavSections } from '../nav-items';
import { visibleViews } from '../views';
import { outreachViews } from './views';
import { load as bare } from './+page.server';

// Each tab keeps its page's capability: the tab hides, and the remote refuses.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

const READ = 'marketing.read';
const AUDIENCES = 'marketing.manageAudiences';

beforeEach(() => {
	auth.held = [];
});

// The route and request are what the build's Sentry wrap around a load reads.
const run = async (load: unknown, url: string) =>
	(load as (e: unknown) => unknown)({
		url: new URL(url),
		route: { id: '/staff/marketing' },
		request: new Request(url)
	});

describe('tabs', () => {
	it.each([
		[
			[READ, AUDIENCES],
			['campaigns', 'audiences']
		],
		[[READ], ['campaigns']],
		[[AUDIENCES], ['audiences']],
		[[], []]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(outreachViews, held).map((v) => v.key)).toEqual(keys);
	});

	it.each([[READ], [AUDIENCES]])('offers the row to a holder of only %s', (cap) => {
		const rows = filterNavSections(staffNavSections, [cap]).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('outreach');
	});
});

describe('remotes', () => {
	it('refuses the audience list to someone holding only marketing.read', async () => {
		auth.held = [READ];
		await expect((getAudienceList as never as () => unknown)()).rejects.toMatchObject({
			status: 403
		});
	});

	it('refuses campaigns to someone holding only audience management', async () => {
		auth.held = [AUDIENCES];
		await expect((getCampaigns as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});
});

describe('addresses', () => {
	it.each([
		[[READ, AUDIENCES], '/staff/marketing/campaigns?x=1'],
		[[AUDIENCES], '/staff/marketing/audiences?x=1'],
		[[], '/staff/marketing/campaigns?x=1']
	])('bare parent, holding %j, goes to %s', async (held, location) => {
		auth.held = held;
		await expect(run(bare, 'http://x/staff/marketing?x=1')).rejects.toMatchObject({
			status: 307,
			location
		});
	});
});
