import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStaffCredits, getStaffPayments } from '#lib/remote/users.remote.js';
import { filterNavSections, staffNavSections } from '../nav-items';
import { visibleViews } from '../views';
import { moneyViews } from './views';
import { load as bare } from './+page.server';
import { load as oldPayments } from '../payments/+page';
import { load as oldCredits } from '../credits/+page';

// Each tab keeps its page's capability: the tab hides, and the remote refuses.
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

const FINANCE = 'finance.read';
const CREDIT = 'credit.read';

beforeEach(() => {
	auth.held = [];
});

// The route and request are what the build's Sentry wrap around a load reads.
const run = async (load: unknown, url: string) =>
	(load as (e: unknown) => unknown)({
		url: new URL(url),
		route: { id: '/staff/money' },
		request: new Request(url)
	});

describe('tabs', () => {
	it.each([
		[
			[FINANCE, CREDIT],
			['payments', 'credits']
		],
		[[FINANCE], ['payments']],
		[[CREDIT], ['credits']],
		[[], []]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(moneyViews, held).map((v) => v.key)).toEqual(keys);
	});

	it.each([[FINANCE], [CREDIT]])('offers the row to a holder of only %s', (cap) => {
		const rows = filterNavSections(staffNavSections, [cap]).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('payments');
	});
});

describe('remotes', () => {
	it('refuses payments to someone holding only credit.read', async () => {
		auth.held = [CREDIT];
		await expect((getStaffPayments as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});

	it('refuses credits to someone holding only finance.read', async () => {
		auth.held = [FINANCE];
		await expect((getStaffCredits as never as (f: object) => unknown)({})).rejects.toMatchObject({
			status: 403
		});
	});
});

describe('addresses', () => {
	it.each([
		[[FINANCE, CREDIT], '/staff/money/payments?x=1'],
		[[CREDIT], '/staff/money/credits?x=1'],
		[[], '/staff/money/payments?x=1']
	])('bare parent, holding %j, goes to %s', async (held, location) => {
		auth.held = held;
		await expect(run(bare, 'http://x/staff/money?x=1')).rejects.toMatchObject({
			status: 307,
			location
		});
	});

	it.each([
		[oldPayments, 'http://x/staff/payments?q=a', '/staff/money/payments?q=a'],
		[oldCredits, 'http://x/staff/credits', '/staff/money/credits']
	])('old address 308s', async (load, url, location) => {
		await expect(run(load, url)).rejects.toMatchObject({ status: 308, location });
	});
});
