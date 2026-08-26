import { describe, it, expect, vi, beforeEach } from 'vitest';

// syncAllSubscriptions sweeps Stripe subscriptions and writes status into D1, and
// (new) reconciles credits for active members by replaying their latest paid
// invoice through allocateCreditsFromInvoice. Mock at the I/O boundaries —
// Stripe, the DB, credit-service, and the two collaborators the sync imports —
// so the real sweep/branch logic and the real allocateCreditsFromInvoice run.

const {
	subscriptionsList,
	invoicesList,
	hasTransaction,
	allocateMonthlyCredits,
	allocateEquipmentCredits,
	buildMemberSubscriptionState,
	syncFromWebhook,
	selectQueue,
	dbSelect,
	dbUpdate
} = vi.hoisted(() => {
	const selectQueue: unknown[][] = [];
	const dbSelect = vi.fn(() => {
		const p = Promise.resolve(selectQueue.shift() ?? []);
		const builder: Record<string, unknown> = {
			from: () => builder,
			where: () => builder,
			limit: () => p,
			then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => p.then(res, rej)
		};
		return builder;
	});
	const dbUpdate = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }));
	return {
		subscriptionsList: vi.fn(),
		invoicesList: vi.fn(),
		hasTransaction: vi.fn(),
		allocateMonthlyCredits: vi.fn(),
		allocateEquipmentCredits: vi.fn(),
		buildMemberSubscriptionState: vi.fn(),
		syncFromWebhook: vi.fn(),
		selectQueue,
		dbSelect,
		dbUpdate
	};
});

vi.mock('$lib/server/db', () => ({ db: { select: dbSelect, update: dbUpdate } }));
vi.mock('$lib/server/stripe', () => ({
	stripe: {
		subscriptions: { list: subscriptionsList },
		invoices: { list: invoicesList }
	}
}));
vi.mock('./credit-service', () => ({
	hasTransaction,
	allocateMonthlyCredits,
	allocateEquipmentCredits
}));
vi.mock('./subscription-service', () => ({ buildMemberSubscriptionState }));
vi.mock('$lib/server/band/band-subscription-service', () => ({ syncFromWebhook }));
vi.mock('$lib/server/reservation/recurring-series-service', () => ({ cancelAllForUser: vi.fn() }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));

import { syncAllSubscriptions } from './subscription-sync-service';

/** A Stripe-shaped subscription, just enough fields for the sweep. */
function sub(overrides: Record<string, unknown> = {}) {
	return {
		id: 'sub_1',
		status: 'active',
		customer: 'cus_1',
		metadata: {},
		items: { data: [] },
		cancel_at_period_end: false,
		...overrides
	};
}

/** Make stripe.subscriptions.list async-iterable over `subs` (the sweep uses `for await`). */
function sweep(subs: unknown[]) {
	subscriptionsList.mockReturnValue({
		async *[Symbol.asyncIterator]() {
			for (const s of subs) yield s;
		}
	});
}

/** A paid invoice with one contribution line worth `cents`. */
function paidInvoice(id: string, cents: number) {
	return {
		id,
		lines: { data: [{ parent: { subscription_item_details: {} }, quantity: 1, amount: cents }] }
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	selectQueue.length = 0;
	buildMemberSubscriptionState.mockResolvedValue({
		startedAt: '2026-01-01T00:00:00.000Z',
		stripeSubscriptionId: 'sub_1',
		hoursPerReset: 4,
		creditsResetAt: '2026-07-01T00:00:00.000Z',
		coveringFees: false,
		cancelAtPeriodEnd: false
	});
	// member lookup, then clearStaleUsers + clearStaleBands selects (empty).
	selectQueue.push([{ id: 'user_1', subscription: null }], [], []);
	invoicesList.mockResolvedValue({ data: [] });
	hasTransaction.mockResolvedValue(false);
});

describe('credit reconciliation during sync', () => {
	it('replays an unprocessed paid invoice and counts it as reconciled', async () => {
		sweep([sub()]);
		invoicesList.mockResolvedValue({ data: [paidInvoice('in_1', 1000)] }); // $10 = 4 free-hour credits + 1000 equipment credits (cents)

		const summary = await syncAllSubscriptions();

		expect(invoicesList).toHaveBeenCalledWith({ subscription: 'sub_1', status: 'paid', limit: 1 });
		expect(allocateMonthlyCredits).toHaveBeenCalledWith('user_1', 4, 'in_1');
		expect(allocateEquipmentCredits).toHaveBeenCalledWith('user_1', 1000, 'in_1');
		expect(summary.usersUpdated).toBe(1);
		expect(summary.creditsReconciled).toBe(1);
		expect(summary.errors).toHaveLength(0);
	});

	it('does not count an already-processed invoice (preserves spent-down balance)', async () => {
		sweep([sub()]);
		invoicesList.mockResolvedValue({ data: [paidInvoice('in_1', 1000)] });
		hasTransaction.mockResolvedValue(true); // webhook already allocated this invoice

		const summary = await syncAllSubscriptions();

		expect(summary.creditsReconciled).toBe(0);
	});

	it('leaves canceled members untouched — no invoice fetch, no credit calls', async () => {
		// Terminal status returns before the member lookup; no stale rows to clear.
		selectQueue.length = 0;
		selectQueue.push([], []); // clearStaleUsers, clearStaleBands
		sweep([sub({ status: 'canceled' })]);

		const summary = await syncAllSubscriptions();

		expect(invoicesList).not.toHaveBeenCalled();
		expect(allocateMonthlyCredits).not.toHaveBeenCalled();
		expect(allocateEquipmentCredits).not.toHaveBeenCalled();
		expect(summary.creditsReconciled).toBe(0);
	});

	it('dry run predicts reconciliation without writing credits', async () => {
		sweep([sub()]);
		invoicesList.mockResolvedValue({ data: [paidInvoice('in_1', 1000)] });

		const summary = await syncAllSubscriptions({ dryRun: true });

		expect(allocateMonthlyCredits).not.toHaveBeenCalled();
		expect(allocateEquipmentCredits).not.toHaveBeenCalled();
		expect(summary.creditsReconciled).toBe(1);
	});

	it('active member with no paid invoice: status written, no credit calls, no error', async () => {
		sweep([sub()]);
		invoicesList.mockResolvedValue({ data: [] });

		const summary = await syncAllSubscriptions();

		expect(allocateMonthlyCredits).not.toHaveBeenCalled();
		expect(summary.usersUpdated).toBe(1);
		expect(summary.creditsReconciled).toBe(0);
		expect(summary.errors).toHaveLength(0);
	});

	it('records a credit failure as a per-user error without losing the status update', async () => {
		sweep([sub()]);
		invoicesList.mockResolvedValue({ data: [paidInvoice('in_1', 1000)] });
		allocateMonthlyCredits.mockRejectedValue(new Error('boom'));

		const summary = await syncAllSubscriptions();

		expect(summary.usersUpdated).toBe(1); // status snapshot still counted
		expect(summary.creditsReconciled).toBe(0);
		expect(summary.errors).toHaveLength(1);
		expect(summary.errors[0]).toMatchObject({ kind: 'user', ref: 'user_1' });
	});
});
