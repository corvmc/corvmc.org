import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: createSubscription had no server-side duplicate guard, so a
// stale tab or double submit could create a second live Stripe subscription
// (double billing). These tests pin the guard and the happy path.

const requireMember = vi.fn(async () => ({
	id: 'user-1',
	email: 'member@example.com',
	name: 'Member',
	stripeId: 'cus_123'
}));
vi.mock('$lib/server/authorization', () => ({
	requireMember: () => requireMember()
}));

const getMemberSubscription = vi.fn(async (): Promise<unknown> => null);
const createCheckoutSession = vi.fn(async () => 'https://checkout.stripe.com/cs_test');
vi.mock('$lib/server/finance/subscription-service', () => ({
	getMemberSubscription: (...args: unknown[]) => getMemberSubscription(...(args as [])),
	createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...(args as [])),
	mapDbSubscription: vi.fn(() => null),
	patchMemberSubscription: vi.fn(async () => undefined),
	updateQuantity: vi.fn(async () => undefined),
	resume: vi.fn(async () => undefined),
	cancel: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/finance/credit-service', () => ({
	getAllBalances: vi.fn(async () => ({ free_hours: 3 })),
	getUsageSinceLastAllocation: vi.fn(async () => 1)
}));

vi.mock('$lib/server/finance/community-stats', () => ({
	getCommunityStats: vi.fn(async () => ({}))
}));

vi.mock('$lib/server/finance/product-config-service', () => ({
	getProductConfig: vi.fn(async () => ({ unitAmountCents: 500 }))
}));

const ensureStripeCustomer = vi.fn(async () => 'cus_123');
vi.mock('$lib/server/finance/stripe-customer-service', () => ({
	ensureStripeCustomer: (...args: unknown[]) => ensureStripeCustomer(...(args as []))
}));

vi.mock('$lib/server/errors', () => ({
	mapDomainError: vi.fn((err: unknown) => {
		throw err;
	})
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		url: new URL('http://localhost/member/membership'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'query' };
		return handler;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	},
	command: (handler: (...a: unknown[]) => unknown) => {
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

const membership = (await import('./membership.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
	getMemberSubscription.mockResolvedValue(null);
});

describe('createSubscription', () => {
	it('rejects when the member already has a subscription snapshot', async () => {
		getMemberSubscription.mockResolvedValue({
			startedAt: '2026-01-01T00:00:00Z',
			stripeSubscriptionId: 'sub_live',
			hoursPerReset: 10,
			creditsResetAt: '2026-08-01T00:00:00Z'
		});

		await expect(
			membership.createSubscription({ amount: 25, coverFees: false })
		).rejects.toMatchObject({ status: 400 });

		expect(createCheckoutSession).not.toHaveBeenCalled();
		expect(ensureStripeCustomer).not.toHaveBeenCalled();
	});

	it('redirects to Stripe checkout when no subscription exists', async () => {
		// redirect(303, url) throws a Redirect — that's the success path.
		await expect(
			membership.createSubscription({ amount: 25, coverFees: false })
		).rejects.toMatchObject({ status: 303, location: 'https://checkout.stripe.com/cs_test' });

		expect(createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'user-1', quantity: 5, coverFees: false })
		);
	});
});

// ---------------------------------------------------------------------------
// getMemberMembership
// ---------------------------------------------------------------------------

/**
 * Regression, now settled structurally rather than by a try/catch.
 *
 * The billing portal URL used to be fetched inside this query's own
 * `Promise.all`, so a Stripe failure took the whole page down rather than
 * hiding one button: every sustaining member's `/member/membership` 500ed if
 * Stripe was down or their customer had been deleted from the dashboard. It is
 * also what made sustaining members unseedable — the dev seed writes a
 * placeholder `cus_seed_…`, which is not falsy, so the portal call reached for a
 * customer that does not exist.
 *
 * The portal is gone and what replaced it is `getBilling()`, a separate query
 * behind its own boundary. So the assertion is no longer "the failure is
 * caught" but "there is no Stripe call here to fail" — which is the stronger
 * claim, and the one that stays true as this query grows.
 */
describe('getMemberMembership', () => {
	it('renders from the database alone, with no live Stripe call', async () => {
		const data = (await membership.getMemberMembership()) as Record<string, unknown>;

		expect(data.credits).toEqual({ free_hours: 3 });
		// The portal link is gone from the payload as well as from the page. A
		// caller still reading it would get `undefined` silently, so pin its
		// absence.
		expect(data).not.toHaveProperty('billingPortalUrl');
	});
});
