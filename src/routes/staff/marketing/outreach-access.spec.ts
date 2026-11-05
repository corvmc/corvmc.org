import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getAudienceDetail,
	getAudienceList,
	getAudienceOptions,
	getAudienceSubscribers,
	getCampaigns,
	getStaffAudienceDetail
} from '$lib/remote/marketing.remote';
import { filterNavSections, staffNavSections } from '../nav-items';
import { visibleViews } from '../views';
import { outreachViews } from './views';
import { load as bare } from './+page.server';

// Each tab keeps its page's capability: the tab hides, and the remote refuses.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('$lib/server/authorization', async (original) => ({
	...(await original<typeof import('$lib/server/authorization')>()),
	...(await import('$lib/server/testing/mock-remote-guards')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('$lib/server/testing/mock-remote-guards')).appServerMock()
);

const service = vi.hoisted(() => ({
	listAudiences: vi.fn(),
	getAudience: vi.fn(),
	listSubscribers: vi.fn()
}));
vi.mock('$lib/server/marketing/audience-service', async (original) => ({
	...(await original<typeof import('$lib/server/marketing/audience-service')>()),
	...service
}));

const READ = 'marketing.read';
const AUDIENCES = 'marketing.manageAudiences';

const AUDIENCE = {
	id: 'aud-1',
	name: 'Newsletter',
	slug: 'newsletter',
	description: 'Monthly',
	allowOptIn: true,
	systemKey: null,
	createdAt: new Date(0),
	subscriberCount: 3
};
const SUBSCRIBERS = [{ email: 'someone@example.com', name: 'Someone' }];

beforeEach(() => {
	auth.held = [];
	vi.clearAllMocks();
	service.listAudiences.mockResolvedValue([AUDIENCE]);
	service.getAudience.mockResolvedValue(AUDIENCE);
	service.listSubscribers.mockResolvedValue(SUBSCRIBERS);
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

describe('audience records (#2436)', () => {
	const records: [string, unknown][] = [
		['getAudienceDetail', getAudienceDetail],
		['getAudienceSubscribers', getAudienceSubscribers],
		['getStaffAudienceDetail', getStaffAudienceDetail]
	];

	it.each(records)('%s refuses someone holding only marketing.read', async (_name, remote) => {
		auth.held = [READ];
		await expect((remote as (id: string) => unknown)('aud-1')).rejects.toMatchObject({
			status: 403
		});
		expect(service.listSubscribers).not.toHaveBeenCalled();
	});

	it('opens the record for someone holding only audience management', async () => {
		auth.held = [AUDIENCES];
		const detail = await (getStaffAudienceDetail as never as (id: string) => Promise<unknown>)(
			'aud-1'
		);
		expect(detail).toEqual({ audience: AUDIENCE, subscribers: SUBSCRIBERS });
	});

	it('gives a campaign picker names and counts, and no more', async () => {
		auth.held = [READ];
		const options = await (getAudienceOptions as never as () => Promise<unknown>)();
		expect(options).toEqual([
			{ id: 'aud-1', name: 'Newsletter', systemKey: null, subscriberCount: 3 }
		]);
		expect(service.listSubscribers).not.toHaveBeenCalled();
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
