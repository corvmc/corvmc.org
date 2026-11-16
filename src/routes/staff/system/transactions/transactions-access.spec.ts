import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStaffCredits, getStaffPayments } from '#lib/remote/users.remote.js';
import { filterNavItems, systemNavItems } from '../../nav-items';
import { visibleViews } from '../../views';
import { transactionViews } from './views';
import { load as bare } from './+page.server';
import { load as oldPayments } from '../../payments/+page';
import { load as oldCredits } from '../../credits/+page';
import { load as oldMoney } from '../../money/[...rest]/+page';

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
		route: { id: '/staff/system/transactions' },
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
		expect(visibleViews(transactionViews, held).map((v) => v.key)).toEqual(keys);
	});

	it.each([[FINANCE], [CREDIT]])('offers the row to a holder of only %s', (cap) => {
		const rows = filterNavItems(systemNavItems, [cap]);
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
		[[FINANCE, CREDIT], '/staff/system/transactions/payments?x=1'],
		[[CREDIT], '/staff/system/transactions/credits?x=1'],
		[[], '/staff/system/transactions/payments?x=1']
	])('bare parent, holding %j, goes to %s', async (held, location) => {
		auth.held = held;
		await expect(run(bare, 'http://x/staff/system/transactions?x=1')).rejects.toMatchObject({
			status: 307,
			location
		});
	});

	it.each([
		[oldPayments, 'http://x/staff/payments?q=a', {}, '/staff/system/transactions/payments?q=a'],
		[oldCredits, 'http://x/staff/credits', {}, '/staff/system/transactions/credits'],
		[oldMoney, 'http://x/staff/money?q=a', { rest: '' }, '/staff/system/transactions?q=a'],
		[
			oldMoney,
			'http://x/staff/money/settings',
			{ rest: 'settings' },
			'/staff/system/transactions/settings'
		]
	])('old address %#: 308s', async (load, url, params, location) => {
		const event = {
			url: new URL(url),
			params,
			route: { id: '/staff/money' },
			request: new Request(url)
		};
		await expect((async () => (load as (e: unknown) => unknown)(event))()).rejects.toMatchObject({
			status: 308,
			location
		});
	});
});
