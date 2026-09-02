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
const createBillingPortalUrl = vi.fn(async (): Promise<string | null> => null);
vi.mock('$lib/server/finance/subscription-service', () => ({
	getMemberSubscription: (...args: unknown[]) => getMemberSubscription(...(args as [])),
	createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...(args as [])),
	mapDbSubscription: vi.fn(() => null),
	patchMemberSubscription: vi.fn(async () => undefined),
	createBillingPortalUrl: (...args: unknown[]) => createBillingPortalUrl(...(args as [])),
	updateQuantity: vi.fn(async () => undefined),
	resume: vi.fn(async () => undefined)
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
	createBillingPortalUrl.mockResolvedValue(null);
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
 * Regression: the billing portal URL was fetched inside the same `Promise.all`
 * as the page's own data, so a Stripe failure took the whole query down rather
 * than hiding one button. Every sustaining member's `/member/membership` 500s
 * if Stripe is down, or if their customer was deleted in the Stripe dashboard.
 *
 * It is also what made sustaining members unseedable: the dev seed writes a
 * placeholder `cus_seed_…`, which is not falsy, so `createBillingPortalUrl`
 * reached for a customer that does not exist and the page never rendered.
 * The portal link is a convenience; the subscription, credits and allocation
 * beside it are the page.
 */
describe('getMemberMembership', () => {
	it('still returns the page when the billing portal is unavailable', async () => {
		createBillingPortalUrl.mockRejectedValue(new Error('No such customer: cus_seed_1a2b3c4d'));

		const data = (await membership.getMemberMembership()) as {
			billingPortalUrl: string | null;
			credits: Record<string, number>;
		};

		expect(data.billingPortalUrl).toBeNull();
		expect(data.credits).toEqual({ free_hours: 3 });
	});

	it('passes the portal URL through when Stripe answers', async () => {
		createBillingPortalUrl.mockResolvedValue('https://billing.stripe.com/session/live');

		const data = (await membership.getMemberMembership()) as { billingPortalUrl: string | null };

		expect(data.billingPortalUrl).toBe('https://billing.stripe.com/session/live');
	});
});
