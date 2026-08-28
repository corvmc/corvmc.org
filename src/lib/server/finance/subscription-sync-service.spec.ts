import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock environment
// ---------------------------------------------------------------------------
vi.mock('$env/dynamic/private', () => ({
	env: { DATABASE_URL: 'postgres://mock' }
}));

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
	subscriptions: {
		list: vi.fn()
	}
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

// ---------------------------------------------------------------------------
// Mock the DB. A tiny chainable builder records update() calls and serves
// canned rows for select().
// ---------------------------------------------------------------------------
const dbState: {
	userByStripeId: Record<string, { id: string; subscription: unknown } | undefined>;
	staleUsers: { id: string }[];
	staleBands: { id: string }[];
	updates: Array<{ table: 'user' | 'group'; set: Record<string, unknown> }>;
} = {
	userByStripeId: {},
	staleUsers: [],
	staleBands: [],
	updates: []
};

// Track which table a select/update chain targets via the last from()/update() arg.
let lastTable: 'user' | 'group' | 'band_site' | 'unknown' = 'unknown';
let pendingCustomerLookup: string | null = null;

vi.mock('$lib/server/db/schema/authentication', () => ({ user: { __table: 'user' } }));
// `bandTiers` and `customDomainStatuses` ride along because `band-site.ts`
// imports them from here for its column enums — the vocabularies still live
// beside the columns they describe until the phase that drops those columns.
vi.mock('$lib/server/db/schema/group', () => ({
	group: { __table: 'group' },
	bandTiers: ['free', 'premium'],
	customDomainStatuses: ['pending', 'active', 'failed']
}));
// Band premium moved off `group` in phase 3b; the stale-subscription sweep
// reads the site row now.
vi.mock('$lib/server/db/schema/band-site', () => ({
	bandSite: {
		__table: 'band_site',
		id: 'band_site.id',
		groupId: 'band_site.group_id',
		tier: 'band_site.tier',
		subscription: 'band_site.subscription'
	}
}));

vi.mock('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
	and: (...c: unknown[]) => ({ op: 'and', c }),
	isNotNull: (col: unknown) => ({ op: 'isNotNull', col }),
	notInArray: (col: unknown, vals: unknown[]) => ({ op: 'notInArray', col, vals }),
	// Needed because the mapper pulls in the finance schema, which uses sql`` for
	// column defaults at module load.
	sql: (..._args: unknown[]) => ({ op: 'sql' })
}));

vi.mock('$lib/server/db', () => {
	const select = () => ({
		from: (table: { __table: 'user' | 'group' }) => {
			lastTable = table.__table;
			return {
				where: (cond: { op?: string; val?: string }) => {
					// user-by-stripe-id lookup uses eq(user.stripeId, customerId)
					if (lastTable === 'user' && cond?.op === 'eq') {
						pendingCustomerLookup = String(cond.val);
						return {
							limit: () => {
								const row = dbState.userByStripeId[pendingCustomerLookup!];
								return Promise.resolve(row ? [row] : []);
							}
						};
					}
					// stale-state queries (isNotNull / and) return the canned stale lists
					const rows = lastTable === 'user' ? dbState.staleUsers : dbState.staleBands;
					return Promise.resolve(rows);
				}
			};
		}
	});

	const update = (table: { __table: 'user' | 'group' }) => ({
		set: (values: Record<string, unknown>) => ({
			where: () => {
				dbState.updates.push({ table: table.__table, set: values });
				return Promise.resolve();
			}
		})
	});

	return { db: { select, update } };
});

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

beforeEach(() => {
	vi.clearAllMocks();
	dbState.userByStripeId = {};
	dbState.staleUsers = [];
	dbState.staleBands = [];
	dbState.updates = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncAllSubscriptions — users', () => {
	it('writes Subscription JSON for an active contribution sub', async () => {
		dbState.userByStripeId['cus_1'] = { id: 'user_1', subscription: null };
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'active', quantity: 7 })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(1);
		const upd = dbState.updates.find((u) => u.table === 'user');
		expect(upd?.set.subscription).toMatchObject({
			stripeSubscriptionId: 'sub_1',
			// credits = contribution quantity × 2 (each $5-unit = 1 hour = 2 credits)
			hoursPerReset: 14,
			creditsResetAt: new Date(1_700_000_000 * 1000).toISOString(),
			coveringFees: false,
			cancelAtPeriodEnd: false
		});
	});

	it('preserves existing startedAt on re-run (idempotent)', async () => {
		dbState.userByStripeId['cus_1'] = {
			id: 'user_1',
			subscription: {
				startedAt: '2020-01-01T00:00:00.000Z',
				stripeSubscriptionId: 'sub_1',
				hoursPerReset: 7,
				creditsResetAt: 'x'
			}
		};
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'active', quantity: 7 })])
		);

		await syncAllSubscriptions();

		const upd = dbState.updates.find((u) => u.table === 'user');
		expect((upd?.set.subscription as { startedAt: string }).startedAt).toBe(
			'2020-01-01T00:00:00.000Z'
		);
	});

	it('clears a user whose only sub is canceled (via step 4), without touching credits', async () => {
		// Canceled sub is terminal → no inline handling. The user still holds local
		// subscription state and is absent from the keep-set, so step 4 clears it.
		dbState.userByStripeId['cus_1'] = { id: 'user_1', subscription: { startedAt: 'x' } };
		dbState.staleUsers = [{ id: 'user_1' }];
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'canceled' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(0);
		expect(summary.usersCleared).toBe(1);
		expect(dbState.updates).toContainEqual({ table: 'user', set: { subscription: null } });
		// no credit columns ever appear in any update payload
		for (const u of dbState.updates) {
			expect(u.set).not.toHaveProperty('creditFreeHours');
			expect(u.set).not.toHaveProperty('creditEquipment');
		}
	});

	it('keeps an active sub even when a stale canceled sub for the same user is also present', async () => {
		// Order-independence: the canceled sub must not undo the active one.
		dbState.userByStripeId['cus_1'] = { id: 'user_1', subscription: null };
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([
				userSub({ id: 'sub_active', customer: 'cus_1', status: 'active', quantity: 4 }),
				userSub({ id: 'sub_old', customer: 'cus_1', status: 'canceled' })
			])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(1);
		expect(summary.usersCleared).toBe(0);
		// only the active write; no null-clear for this user
		expect(dbState.updates).not.toContainEqual({ table: 'user', set: { subscription: null } });
	});

	it('records an error and continues when no local user matches', async () => {
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_missing', status: 'active' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(0);
		expect(summary.errors).toHaveLength(1);
		expect(summary.errors[0]).toMatchObject({ kind: 'user', ref: 'cus_missing' });
	});

	it('skips trialing subs', async () => {
		dbState.userByStripeId['cus_1'] = { id: 'user_1', subscription: null };
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'trialing' })])
		);

		const summary = await syncAllSubscriptions();

		expect(summary.skipped).toBe(1);
		expect(summary.usersUpdated).toBe(0);
		expect(dbState.updates).toHaveLength(0);
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

	it('clears a band whose only sub is canceled via step 4 (no inline syncFromWebhook)', async () => {
		// Terminal band sub is not handled inline; step 4 resets tier to free.
		dbState.staleBands = [{ id: 'band_1' }];
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([bandSub({ id: 'sub_b', bandId: 'band_1', status: 'canceled' })])
		);

		const summary = await syncAllSubscriptions();

		expect(mockSyncFromWebhook).not.toHaveBeenCalled();
		expect(summary.bandsCleared).toBe(1);
		// Cleared on the site row since phase 3b — and it is an UPDATE, not a
		// delete: `band_page_config` and `band_media` cascade from this row, so a
		// band whose subscription lapsed keeps its microsite content.
		expect(dbState.updates).toContainEqual({
			table: 'band_site',
			set: expect.objectContaining({ tier: 'free', subscription: null })
		});
	});
});

describe('syncAllSubscriptions — reconciliation & safety', () => {
	it('clears stale local users not seen in the sweep', async () => {
		dbState.userByStripeId['cus_1'] = { id: 'user_1', subscription: null };
		dbState.staleUsers = [{ id: 'user_stale' }];
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'active' })])
		);

		const summary = await syncAllSubscriptions();

		// 1 active update + 1 stale clear
		expect(summary.usersCleared).toBe(1);
		expect(dbState.updates).toContainEqual({ table: 'user', set: { subscription: null } });
	});

	it('skips all clearing when the sweep returns zero subscriptions', async () => {
		dbState.staleUsers = [{ id: 'user_stale' }];
		dbState.staleBands = [{ id: 'band_stale' }];
		mockStripe.subscriptions.list.mockReturnValue(asyncIterableOf([]));

		const summary = await syncAllSubscriptions();

		expect(summary.usersCleared).toBe(0);
		expect(summary.bandsCleared).toBe(0);
		expect(dbState.updates).toHaveLength(0);
		expect(summary.errors.some((e) => e.kind === 'sweep')).toBe(true);
	});

	it('dryRun computes counts but issues no DB updates', async () => {
		dbState.userByStripeId['cus_1'] = { id: 'user_1', subscription: null };
		mockStripe.subscriptions.list.mockReturnValue(
			asyncIterableOf([userSub({ id: 'sub_1', customer: 'cus_1', status: 'active' })])
		);

		const summary = await syncAllSubscriptions({ dryRun: true });

		expect(summary.usersUpdated).toBe(1);
		expect(dbState.updates).toHaveLength(0);
	});
});
