import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAnnualReportPage } from '#lib/remote/reports.remote.js';
import { getVolunteerReportPage } from '#lib/remote/volunteer.remote.js';
import { getSpendReport } from '#lib/remote/inventory.remote.js';
import { getMusicSalesReport } from '#lib/remote/staff-music.remote.js';
import { filterNavSections, staffNavSections } from '../nav-items';
import { visibleViews } from '../views';
import { reportViews } from './views';
import { load as bare } from './+page.server';
import { load as oldSpend } from '../inventory/spend/+page';

// Each tab keeps its page's capability: the tab hides, and the remote refuses.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

const ANNUAL = 'finance.read';
const VOLUNTEERING = 'volunteer.report';
const SPEND = 'inventory.report';
const MUSIC = 'music.read';
const ALL = [ANNUAL, VOLUNTEERING, SPEND, MUSIC];

beforeEach(() => {
	auth.held = [];
});

// The route and request are what the build's Sentry wrap around a load reads.
const run = async (load: unknown, url: string) =>
	(load as (e: unknown) => unknown)({
		url: new URL(url),
		route: { id: '/staff/reports' },
		request: new Request(url)
	});

describe('tabs', () => {
	it.each([
		[ANNUAL, 'annual'],
		[VOLUNTEERING, 'volunteering'],
		[SPEND, 'inventory-spend'],
		[MUSIC, 'music']
	])('holding only %s shows only %s, and still offers the row', (cap, key) => {
		expect(visibleViews(reportViews, [cap]).map((v) => v.key)).toEqual([key]);
		const rows = filterNavSections(staffNavSections, [cap]).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('reports');
	});

	it('shows all four, in order, to someone holding them all', () => {
		expect(visibleViews(reportViews, ALL).map((v) => v.key)).toEqual([
			'annual',
			'volunteering',
			'inventory-spend',
			'music'
		]);
	});
});

describe('remotes', () => {
	it.each([
		[ANNUAL, getAnnualReportPage],
		[VOLUNTEERING, getVolunteerReportPage],
		[SPEND, getSpendReport],
		[MUSIC, getMusicSalesReport]
	])('without %s, its report is refused to a holder of the others', async (cap, remote) => {
		auth.held = ALL.filter((c) => c !== cap);
		await expect((remote as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});
});

describe('addresses', () => {
	it.each([
		[ALL, '/staff/reports/annual?from=2026-01-01'],
		[[VOLUNTEERING, SPEND], '/staff/reports/volunteering?from=2026-01-01'],
		[[SPEND], '/staff/reports/inventory-spend?from=2026-01-01'],
		[[], '/staff/reports/annual?from=2026-01-01']
	])('bare parent, holding %j, goes to %s', async (held, location) => {
		auth.held = held;
		await expect(run(bare, 'http://x/staff/reports?from=2026-01-01')).rejects.toMatchObject({
			status: 307,
			location
		});
	});

	it.each([
		[oldSpend, 'http://x/staff/inventory/spend?from=a', '/staff/reports/inventory-spend?from=a']
	])('old address 308s', async (load, url, location) => {
		await expect(run(load, url)).rejects.toMatchObject({ status: 308, location });
	});
});
