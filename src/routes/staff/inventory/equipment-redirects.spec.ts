import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStaffOrders, getAcquisitions } from '#lib/remote/inventory.remote.js';
import { activeNavKey } from '../nav-items';
import { load as reportsAcquisitions } from '../reports/acquisitions/+page';
import { load as compliance } from './compliance/+page';

// Equipment's lists (#2767): moved addresses land on a list, and each list keeps its gate.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

beforeEach(() => {
	auth.held = [];
});

// The route and request are what the build's Sentry wrap around a load reads.
const run = async (load: unknown, url: string) =>
	(load as (e: unknown) => unknown)({
		url: new URL(url),
		route: { id: new URL(url).pathname },
		request: new Request(url)
	});

describe('moved addresses', () => {
	it.each([
		[
			reportsAcquisitions,
			'http://x/staff/reports/acquisitions?owed=1',
			'/staff/inventory/acquisitions?owed=1&via=reports'
		],
		[
			compliance,
			'http://x/staff/inventory/compliance',
			'/staff/inventory/acquisitions?show=form-8282&via=compliance'
		]
	])('308s to the Equipment list', async (load, url, location) => {
		await expect(run(load, url)).rejects.toMatchObject({ status: 308, location });
		expect(activeNavKey(location.split('?')[0])).toBe('gear');
	});
});

describe('remotes', () => {
	it('refuses the Orders list without inventory.read', async () => {
		await expect((getStaffOrders as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});

	it('refuses Acquisitions to a holder of inventory.read alone', async () => {
		auth.held = ['inventory.read'];
		await expect((getAcquisitions as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});
});
