import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The rollup's own logic, with every module service mocked.
 *
 * The opposite choice to the module specs beside it, because this file writes
 * no SQL: it groups, orders, subtracts for net, and decides coverage. A real
 * database would test the services again and this not at all.
 */

const totalsByKindAndCategory = vi.fn();
const ledgerStartsAt = vi.fn();

vi.mock('$lib/server/finance/financial-entry-service', () => ({
	totalsByKindAndCategory,
	ledgerStartsAt
}));
vi.mock('$lib/server/volunteer/volunteer-report-service', () => ({
	getVolunteerTotals: vi.fn(async () => ({ totalMinutes: 600, volunteerCount: 4, logCount: 9 })),
	getContributedValue: vi.fn(async () => ({
		impactValueCents: 5000,
		recognizableServicesCents: 2000,
		unpricedSpecializedMinutes: 0,
		rateCents: 3400,
		rateSource: 'test'
	}))
}));
vi.mock('$lib/server/finance/community-stats', () => ({
	getCommunityStats: vi.fn(async () => ({
		sustainingMemberCount: 12,
		totalFreeHoursAllocated: 48,
		participationPercent: 30
	}))
}));
vi.mock('$lib/server/event/event-report-service', () => ({
	getEventTotals: vi.fn(async () => ({
		cmcByKind: { show: 3, work_party: 1, meeting: 0, class: 0, market: 0 },
		cmcTotal: 4,
		bandListings: 2,
		communityListings: 1,
		cancelled: 0
	}))
}));
vi.mock('$lib/server/reservation/reservation-report-service', () => ({
	getRoomUseTotals: vi.fn(async () => ({
		sessions: 20,
		hours: 44,
		distinctBookers: 7,
		noShows: 1
	}))
}));

const { getAnnualReport } = await import('./annual-report-service');

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

beforeEach(() => {
	totalsByKindAndCategory.mockResolvedValue([]);
	ledgerStartsAt.mockResolvedValue(null);
});

describe('the money section', () => {
	it('keeps in-kind and pass-through out of net', async () => {
		// The whole reason `kind` is a column: a naive sum of these four numbers
		// claims the collective earned money it is holding for someone else and
		// goods it was given.
		totalsByKindAndCategory.mockResolvedValue([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 1000 },
			{ kind: 'spent', category: 'card_fees', totalCents: -300 },
			{ kind: 'in_kind', category: 'equipment', totalCents: 50_000 },
			{ kind: 'pass_through', category: 'act_payout', totalCents: 7000 }
		]);

		const report = await getAnnualReport(YEAR);

		expect(report.money.netCents).toBe(700);
		expect(report.money.totalsByKind.in_kind).toBe(50_000);
		expect(report.money.totalsByKind.pass_through).toBe(7000);
	});

	it('subtracts the spend, on a ledger whose spend is stored negative', async () => {
		// The regression #1235 was: `earned - spent` on a signed column. The old
		// fixture wrote spend as +300, which made the wrong expression produce the
		// right answer, so nothing failed while the report overstated net by twice
		// the spend on every real ledger.
		//
		// `financialEntry.amountCents` is documented signed — "positive into the
		// collective, negative out" — so this asserts the arithmetic against a
		// ledger shaped like the database, with the answer worked out by hand.
		totalsByKindAndCategory.mockResolvedValue([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 41_250 },
			{ kind: 'spent', category: 'card_fees', totalCents: -1806 },
			{ kind: 'spent', category: 'act_guarantee', totalCents: -12_000 }
		]);

		const report = await getAnnualReport(YEAR);

		expect(report.money.totalsByKind.spent).toBe(-13_806);
		// 412.50 earned less 138.06 spent is 274.44 — never 550.56.
		expect(report.money.netCents).toBe(27_444);
	});

	it('leaves net at the earnings when nothing was spent', async () => {
		totalsByKindAndCategory.mockResolvedValue([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 5000 }
		]);
		const report = await getAnnualReport(YEAR);
		expect(report.money.netCents).toBe(5000);
	});

	it('names every kind even when nothing was recorded under it', async () => {
		const report = await getAnnualReport(YEAR);
		expect(Object.keys(report.money.byKind).sort()).toEqual([
			'earned',
			'in_kind',
			'pass_through',
			'spent'
		]);
		expect(report.money.byKind.earned).toEqual([]);
		expect(report.money.netCents).toBe(0);
	});

	it('orders the lines largest first, within a kind', async () => {
		totalsByKindAndCategory.mockResolvedValue([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 200 },
			{ kind: 'earned', category: 'membership', totalCents: 900 },
			{ kind: 'earned', category: 'donation', totalCents: 500 }
		]);

		const report = await getAnnualReport(YEAR);

		expect(report.money.byKind.earned.map((l) => l.category)).toEqual([
			'membership',
			'donation',
			'ticket_sales'
		]);
	});

	it('does not let one kind’s category answer for another', async () => {
		totalsByKindAndCategory.mockResolvedValue([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 300 },
			{ kind: 'pass_through', category: 'ticket_sales', totalCents: 700 }
		]);

		const report = await getAnnualReport(YEAR);

		expect(report.money.byKind.earned).toEqual([{ category: 'ticket_sales', totalCents: 300 }]);
		expect(report.money.byKind.pass_through).toEqual([
			{ category: 'ticket_sales', totalCents: 700 }
		]);
	});
});

describe('what the record can answer for', () => {
	it('is complete when the range begins after the first entry', async () => {
		ledgerStartsAt.mockResolvedValue(new Date('2025-06-01T00:00:00Z'));
		const report = await getAnnualReport(YEAR);
		expect(report.coverage.complete).toBe(true);
	});

	it('is incomplete when the range reaches back before the record does', async () => {
		// The failure this exists to catch: the two years before the ledger sum
		// to zero and would otherwise render as a quiet year.
		ledgerStartsAt.mockResolvedValue(new Date('2026-03-01T00:00:00Z'));
		const report = await getAnnualReport(YEAR);
		expect(report.coverage.complete).toBe(false);
		expect(report.coverage.startsAt).toEqual(new Date('2026-03-01T00:00:00Z'));
	});

	it('treats an unbounded request as incomplete, because it asks for all time', async () => {
		ledgerStartsAt.mockResolvedValue(new Date('2026-03-01T00:00:00Z'));
		expect((await getAnnualReport({})).coverage.complete).toBe(false);
	});

	it('is complete against an empty ledger, which is missing nothing', async () => {
		const report = await getAnnualReport(YEAR);
		expect(report.coverage.startsAt).toBeNull();
		expect(report.coverage.complete).toBe(true);
	});
});

describe('the sections it does not compute', () => {
	it('passes each module’s own numbers through unchanged', async () => {
		const report = await getAnnualReport(YEAR);

		expect(report.volunteering.totals.volunteerCount).toBe(4);
		expect(report.volunteering.contributed.recognizableServicesCents).toBe(2000);
		expect(report.membership.sustainingMemberCount).toBe(12);
		expect(report.events.cmcTotal).toBe(4);
		expect(report.room.hours).toBe(44);
	});
});
