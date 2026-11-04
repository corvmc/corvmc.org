import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFlagsQueue } from '$lib/remote/flags.remote';
import { getIncidentLog } from '$lib/remote/incidents.remote';
import { filterNavSections, staffNavSections } from '../nav-items';
import { visibleViews } from '../views';
import { moderationViews } from './views';
import { load as bare } from './+page.server';
import { load as oldFlags } from '../flags/+page';
import { load as oldIncidents } from '../incidents/+page';

// Each tab keeps its page's capability: the tab hides, and the remote refuses.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('$lib/server/authorization', async (original) => ({
	...(await original<typeof import('$lib/server/authorization')>()),
	...(await import('$lib/server/testing/mock-remote-guards')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('$lib/server/testing/mock-remote-guards')).appServerMock()
);

const FLAGS = 'moderation.reviewFlags';
const INCIDENTS = 'incident.read';

beforeEach(() => {
	auth.held = [];
});

// The route and request are what the build's Sentry wrap around a load reads.
const run = async (load: unknown, url: string) =>
	(load as (e: unknown) => unknown)({
		url: new URL(url),
		route: { id: '/staff/moderation' },
		request: new Request(url)
	});

describe('tabs', () => {
	it.each([
		[
			[FLAGS, INCIDENTS],
			['flags', 'incidents']
		],
		[[FLAGS], ['flags']],
		[[INCIDENTS], ['incidents']],
		[[], []]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(moderationViews, held).map((v) => v.key)).toEqual(keys);
	});

	it.each([[FLAGS], [INCIDENTS]])('offers the row to a holder of only %s', (cap) => {
		const rows = filterNavSections(staffNavSections, [cap]).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('moderation');
	});
});

describe('remotes', () => {
	it('refuses the flag queue to someone holding only incidents', async () => {
		auth.held = [INCIDENTS];
		await expect((getFlagsQueue as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});

	it('refuses the incident log to someone holding only flags', async () => {
		auth.held = [FLAGS];
		await expect((getIncidentLog as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});
});

describe('addresses', () => {
	it.each([
		[[FLAGS, INCIDENTS], '/staff/moderation/flags?x=1'],
		[[INCIDENTS], '/staff/moderation/incidents?x=1'],
		[[], '/staff/moderation/flags?x=1']
	])('bare parent, holding %j, goes to %s', async (held, location) => {
		auth.held = held;
		await expect(run(bare, 'http://x/staff/moderation?x=1')).rejects.toMatchObject({
			status: 307,
			location
		});
	});

	it.each([
		[oldFlags, 'http://x/staff/flags?status=pending', '/staff/moderation/flags?status=pending'],
		[oldIncidents, 'http://x/staff/incidents', '/staff/moderation/incidents']
	])('old address 308s', async (load, url, location) => {
		await expect(run(load, url)).rejects.toMatchObject({ status: 308, location });
	});
});
