import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The comparison, and what it deliberately leaves out of the Stripe side.
 *
 * The type filter is the part that cannot be validated from a test — these
 * pin the intent so a later change to it is a decision rather than a drift.
 */

const stripeSettledCents = vi.fn(async () => 0);
vi.mock('./financial-entry-service', () => ({
	stripeSettledCents: (...a: unknown[]) => stripeSettledCents(...(a as [])),
	// The module also exports RangeFilter as a type; nothing else is called.
	recordEntries: vi.fn()
}));

const captureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({
	captureException: (...a: unknown[]) => captureException(...a)
}));

let transactions: { type: string; net: number }[] = [];
vi.mock('$lib/server/stripe', () => ({
	stripe: {
		balanceTransactions: {
			list: () => ({
				async *[Symbol.asyncIterator]() {
					for (const tx of transactions) yield tx;
				}
			})
		}
	}
}));

const { reconcileStripeWindow, lastClosedWeek } = await import('./reconciliation');

const range = { from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') };

beforeEach(() => {
	vi.clearAllMocks();
	transactions = [];
	stripeSettledCents.mockResolvedValue(0);
});

describe('what counts on the Stripe side', () => {
	it('sums the balance, so a Connect sale counts only the application fee', async () => {
		// The band's share never reaches the platform balance, which is exactly
		// why a charges-based comparison would be short by it on every release.
		transactions = [
			{ type: 'charge', net: 941 },
			{ type: 'application_fee', net: 100 }
		];
		stripeSettledCents.mockResolvedValue(1041);

		const result = await reconcileStripeWindow(range, 100);
		expect(result.stripeCents).toBe(1041);
		expect(result.deltaCents).toBe(0);
	});

	it('ignores a payout to the bank, which is not revenue leaving', async () => {
		transactions = [
			{ type: 'charge', net: 5000 },
			{ type: 'payout', net: -5000 }
		];
		stripeSettledCents.mockResolvedValue(5000);

		expect((await reconcileStripeWindow(range, 100)).deltaCents).toBe(0);
	});

	it('ignores a Connect transfer out for the same reason', async () => {
		transactions = [
			{ type: 'charge', net: 1000 },
			{ type: 'transfer', net: -900 }
		];
		stripeSettledCents.mockResolvedValue(1000);

		expect((await reconcileStripeWindow(range, 100)).deltaCents).toBe(0);
	});

	it('tallies every type it sees, including the ones it does not count', async () => {
		// A type nobody anticipated should be a number to look at rather than a
		// silently missing one — the filter is the untested part.
		transactions = [
			{ type: 'charge', net: 100 },
			{ type: 'payout', net: -100 },
			{ type: 'payout', net: -50 }
		];

		expect((await reconcileStripeWindow(range, 100)).seenTypes).toEqual({
			charge: 1,
			payout: 2
		});
	});
});

describe('when the two disagree', () => {
	it('stays quiet inside the threshold', async () => {
		transactions = [{ type: 'charge', net: 1000 }];
		stripeSettledCents.mockResolvedValue(1050);

		await reconcileStripeWindow(range, 100);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('raises past it, carrying both numbers', async () => {
		transactions = [{ type: 'charge', net: 1000 }];
		stripeSettledCents.mockResolvedValue(5000);

		await reconcileStripeWindow(range, 100);
		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				event: 'financial-entry.reconcile',
				ledgerCents: 5000,
				stripeCents: 1000,
				deltaCents: 4000
			})
		);
	});
});

describe('the window', () => {
	it('is a closed week, never a partial day', async () => {
		const week = lastClosedWeek(new Date('2026-09-16T13:45:00Z'));

		expect(week.to.toISOString()).toBe('2026-09-16T00:00:00.000Z');
		expect(week.from.toISOString()).toBe('2026-09-09T00:00:00.000Z');
	});
});
