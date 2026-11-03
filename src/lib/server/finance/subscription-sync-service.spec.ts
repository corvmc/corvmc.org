import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock environment
// ---------------------------------------------------------------------------
vi.mock('$env/dynamic/private', () => ({
	env: { DATABASE_URL: 'postgres://mock' }
}));

// The stale-state sweeps are WHERE clauses over real rows.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});
vi.mock('$lib/server/db', () => ({ db: testDb }));

// Product config — contribution product id used to match the contribution line
vi.mock('./product-config-service', () => ({
	getStripeProductId: vi.fn().mockImplementation((key: string) => {
		if (key === 'contribution') return Promise.resolve('prod_contribution');
		return Promise.resolve(`prod_${key}`);
	})
}));

// ---------------------------------------------------------------------------
// Mock Stripe SDK — subscriptions.list returns an async-iterable so `for await`
// walks it exactly like the auto-pager would.
// ---------------------------------------------------------------------------
const mockStripe = {
	subscriptions: { list: vi.fn() },
	// Credit reconciliation reads the latest paid invoice; none here.
	invoices: { list: vi.fn(async () => ({ data: [] })) }
};
vi.mock('$lib/server/stripe', () => ({ stripe: mockStripe }));

function asyncIterableOf<T>(items: T[]) {
	return {
		[Symbol.asyncIterator]() {
			let i = 0;
			return {
				next() {
					return Promise.resolve(
						i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true }
					);
				}
			};
		}
	};
}

// ---------------------------------------------------------------------------
// Mock band subscription service (reused verbatim for bands)
// ---------------------------------------------------------------------------
const mockSyncFromWebhook = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/band/band-subscription-service', () => ({
	syncFromWebhook: mockSyncFromWebhook
}));

const { syncAllSubscriptions } = await import('./subscription-sync-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userSub(opts: {
	id: string;
	customer: string;
	status: string;
	quantity?: number;
	periodEnd?: number;
}) {
	return {
		id: opts.id,
		customer: opts.customer,
		status: opts.status,
		cancel_at_period_end: false,
		metadata: { subscription_type: 'contribution' },
		items: {
			data: [
				{
					quantity: opts.quantity ?? 5,
					current_period_end: opts.periodEnd ?? 1_700_000_000,
					price: {
						product: 'prod_contribution',
						unit_amount: 500,
						recurring: { interval: 'month' }
					}
				}
			]
		}
	};
}

function bandSub(opts: { id: string; bandId: string; status: string }) {
	return {
		id: opts.id,
		customer: 'cus_band_owner',
		status: opts.status,
		cancel_at_period_end: false,
		metadata: { subscription_type: 'band_premium', band_id: opts.bandId },
		items: {
			data: [{ current_period_end: 1_700_000_000, price: { recurring: { interval: 'month' } } }]
		}
	};
}

function member(id: string, stripeId: string | null, subscription: unknown = null) {
	sqlite
		.prepare(
			`insert into user (id, name, email, stripe_id, subscription, credit_free_hours, credit_equipment)
			 values (?, ?, ?, ?, ?, 3, 4)`
		)
		.run(
			id,
			id,
			`${id}@example.com`,
			stripeId,
			subscription === null ? null : JSON.stringify(subscription)
		);
}

function site(groupId: string, subscription: unknown) {
	sqlite
		.prepare(`insert into band_site (id, group_id, tier, subscription) values (?, ?, 'premium', ?)`)
		.run(`site-${groupId}`, groupId, subscription === null ? null : JSON.stringify(subscription));
}

const subscriptionOf = (id: string) => {
	const row = sqlite.prepare('select subscription from user where id = ?').get(id) as {
		subscription: string | null;
	};
	return row.subscription === null ? null : JSON.parse(row.subscription);
};
const creditsOf = (id: string) =>
	sqlite
		.prepare(
			'select credit_free_hours as free, credit_equipment as equipment from user where id = ?'
		)
		.get(id);
const siteOf = (groupId: string) =>
	sqlite.prepare('select tier, subscription from band_site where group_id = ?').get(groupId);

beforeEach(() => {
	vi.clearAllMocks();
	mockStripe.invoices.list.mockResolvedValue({ data: [] });
	sqlite.exec('delete from user');
	sqlite.exec('delete from band_site');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncAllSubscriptions — users', () => {
	it('writes Subscription JSON for an active contribution sub, on that member', async () => {
		member('user_1', 'cus_1');
		member('user_2', 'cus_2');
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([
				userSub({
					id: 'sub_1',
					customer: 'cus_1',
					status: 'active',
					quantity: 7
				})
			])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(1);
		expect(subscriptionOf('user_1')).toMatchObject({
			stripeSubscriptionId: 'sub_1',
			// credits = contribution quantity × 2 (each $5-unit = 1 hour = 2 credits)
			hoursPerReset: 14,
			creditsResetAt: new Date(1_700_000_000 * 1000).toISOString(),
			coveringFees: false,
			cancelAtPeriodEnd: false
		});
		expect(subscriptionOf('user_2')).toBeNull();
	});

	it('preserves existing startedAt on re-run (idempotent)', async () => {
		member('user_1', 'cus_1', {
			startedAt: '2020-01-01T00:00:00.000Z',
			stripeSubscriptionId: 'sub_1',
			hoursPerReset: 7,
			creditsResetAt: 'x'
		});
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([
				userSub({
					id: 'sub_1',
					customer: 'cus_1',
					status: 'active',
					quantity: 7
				})
			])
		);

		await syncAllSubscriptions();

		expect(subscriptionOf('user_1').startedAt).toBe('2020-01-01T00:00:00.000Z');
	});

	it('clears a user whose only sub is canceled (via step 4), without touching credits', async () => {
		// Canceled sub is terminal → no inline handling. The user still holds local
		// subscription state and is absent from the keep-set, so step 4 clears it.
		member('user_1', 'cus_1', { startedAt: 'x' });
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'canceled' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(0);
		expect(summary.usersCleared).toBe(1);
		expect(subscriptionOf('user_1')).toBeNull();
		expect(creditsOf('user_1')).toEqual({ free: 3, equipment: 4 });
	});

	it('keeps an active sub even when a stale canceled sub for the same user is also present', async () => {
		// Order-independence: the canceled sub must not undo the active one.
		member('user_1', 'cus_1');
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([
				userSub({
					id: 'sub_active',
					customer: 'cus_1',
					status: 'active',
					quantity: 4
				}),
				userSub({ id: 'sub_old', customer: 'cus_1', status: 'canceled' })
			])
		);

		const summary = await syncAllSubscriptions();

		expect(summary).toMatchObject({ usersUpdated: 1, usersCleared: 0 });
		expect(subscriptionOf('user_1')).toMatchObject({
			stripeSubscriptionId: 'sub_active'
		});
	});

	it('records an error and continues when no local user matches', async () => {
		member('user_1', 'cus_other');
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_missing', status: 'active' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(0);
		expect(summary.errors).toHaveLength(1);
		expect(summary.errors[0]).toMatchObject({
			kind: 'user',
			ref: 'cus_missing'
		});
		expect(subscriptionOf('user_1')).toBeNull();
	});

	it('skips trialing subs', async () => {
		member('user_1', 'cus_1');
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'trialing' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary).toMatchObject({ skipped: 1, usersUpdated: 0 });
		expect(subscriptionOf('user_1')).toBeNull();
	});
});

describe('syncAllSubscriptions — bands', () => {
	it('delegates active band_premium to syncFromWebhook and counts updated', async () => {
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([bandSub({ id: 'sub_b', bandId: 'band_1', status: 'active' })])
		);

		const summary = await syncAllSubscriptions();

		expect(mockSyncFromWebhook).toHaveBeenCalledWith(
			'band_1',
			expect.objectContaining({ id: 'sub_b' })
		);
		expect(summary.bandsUpdated).toBe(1);
	});

	it('clears a band whose only sub is canceled via step 4, keeping the site row', async () => {
		// Terminal band sub is not handled inline; step 4 resets tier to free. An
		// UPDATE, not a delete: `band_page_config` and `band_media` cascade from
		// this row, so a band whose subscription lapsed keeps its microsite content.
		site('band_1', { stripeSubscriptionId: 'sub_b' });
		site('band_2', { stripeSubscriptionId: 'sub_live' });
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([
				bandSub({ id: 'sub_b', bandId: 'band_1', status: 'canceled' }),
				bandSub({ id: 'sub_live', bandId: 'band_2', status: 'active' })
			])
		);

		const summary = await syncAllSubscriptions();

		expect(mockSyncFromWebhook).toHaveBeenCalledTimes(1);
		expect(summary.bandsCleared).toBe(1);
		expect(siteOf('band_1')).toEqual({ tier: 'free', subscription: null });
		expect(siteOf('band_2')).toMatchObject({ tier: 'premium' });
	});
});

describe('syncAllSubscriptions — reconciliation & safety', () => {
	it('clears stale local users not seen in the sweep, and only them', async () => {
		member('user_1', 'cus_1', { startedAt: 'x' });
		member('user_stale', 'cus_stale', { startedAt: 'y' });
		member('user_never', 'cus_never');
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'active' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersCleared).toBe(1);
		expect(subscriptionOf('user_stale')).toBeNull();
		expect(subscriptionOf('user_1')).not.toBeNull();
	});

	it('skips all clearing when the sweep returns zero subscriptions', async () => {
		member('user_stale', 'cus_stale', { startedAt: 'y' });
		site('band_stale', { stripeSubscriptionId: 'sub_x' });
		mockStripe.subscriptions.list.mockReturnValue(asyncIterableOf([]));

		const summary = await syncAllSubscriptions();

		expect(summary).toMatchObject({ usersCleared: 0, bandsCleared: 0 });
		expect(subscriptionOf('user_stale')).toEqual({ startedAt: 'y' });
		expect(siteOf('band_stale')).toMatchObject({ tier: 'premium' });
		expect(summary.errors.some((e) => e.kind === 'sweep')).toBe(true);
	});

	it('dryRun computes counts but issues no DB updates', async () => {
		member('user_1', 'cus_1');
		member('user_stale', 'cus_stale', { startedAt: 'y' });
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'active' })])
		);

		const summary = await syncAllSubscriptions({ dryRun: true });

		expect(summary).toMatchObject({ usersUpdated: 1, usersCleared: 1 });
		expect(subscriptionOf('user_1')).toBeNull();
		expect(subscriptionOf('user_stale')).toEqual({ startedAt: 'y' });
	});
});
