import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFlagsQueue } from '#lib/remote/flags.remote.js';
import { getIncidentLog } from '#lib/remote/incidents.remote.js';
import { getBlocklist } from '#lib/remote/blocklist.remote.js';
import { filterNavSections, staffNavSections } from '../nav-items';
import { visibleViews } from '../views';
import { moderationViews } from './views';
import { load as bare } from './+page.server';
import { load as oldFlags } from '../flags/+page';
import { load as oldIncidents } from './incidents/+page';

// Each tab keeps its page's capability: the tab hides, and the remote refuses.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

const FLAGS = 'moderation.reviewFlags';
const INCIDENTS = 'incident.read';
const BAN = 'user.ban';

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
			[FLAGS, BAN],
			['flags', 'blocklist']
		],
		[[FLAGS], ['flags']],
		[[INCIDENTS], []],
		[[BAN], ['blocklist']],
		[[], []]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(moderationViews, held).map((v) => v.key)).toEqual(keys);
	});

	it.each([[FLAGS], [BAN]])('offers the row to a holder of only %s', (cap) => {
		const rows = filterNavSections(staffNavSections, [cap]).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('moderation');
	});

	// Incidents are a Governance row of their own (#3112).
	it('offers Incidents, not Moderation, to a holder of only incident.read', () => {
		const rows = filterNavSections(staffNavSections, [INCIDENTS]).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('incidents');
		expect(rows.map((r) => r.key)).not.toContain('moderation');
	});
});

describe('remotes', () => {
	it('refuses the flag queue to someone holding only incidents', async () => {
		auth.held = [INCIDENTS];
		await expect((getFlagsQueue as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});

	it('refuses the blocklist to someone holding only flags', async () => {
		auth.held = [FLAGS];
		await expect((getBlocklist as never as () => unknown)()).rejects.toMatchObject({
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
		[[FLAGS, BAN], '/staff/moderation/flags?x=1'],
		[[BAN], '/staff/moderation/blocklist?x=1'],
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
		[
			oldIncidents,
			'http://x/staff/moderation/incidents',
			'/staff/incidents?via=%2Fstaff%2Fmoderation%2Fincidents'
		]
	])('old address 308s', async (load, url, location) => {
		await expect(run(load, url)).rejects.toMatchObject({ status: 308, location });
	});
});
