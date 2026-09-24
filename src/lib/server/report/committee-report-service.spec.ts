import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The committee's cut of the rollup, with every module service mocked.
 *
 * Like the annual spec beside it, this file writes no SQL. What it owns is
 * which filter each service is handed, and that the cut stays inside the
 * committee's own projects.
 */

const totalsByKindAndCategory = vi.fn();
const getVolunteerTotals = vi.fn();
const listProjects = vi.fn();
const getProjectBurn = vi.fn();

vi.mock('$lib/server/finance/financial-entry-service', () => ({ totalsByKindAndCategory }));
vi.mock('$lib/server/volunteer/volunteer-report-service', () => ({ getVolunteerTotals }));
vi.mock('$lib/server/project/project-service', () => ({ listProjects, getProjectBurn }));

const { getCommitteeReport } = await import('./committee-report-service');

const burn = (budgetCents: number | null, totalCents: number) => ({
	budgetCents,
	cash: { contractorCents: totalCents, purchaseOrderCents: 0, acquisitionCents: 0, totalCents },
	remainingCents: budgetCents === null ? null : budgetCents - totalCents
});

beforeEach(() => {
	vi.clearAllMocks();
	totalsByKindAndCategory.mockResolvedValue([]);
	getVolunteerTotals.mockResolvedValue({ totalMinutes: 0, volunteerCount: 0, logCount: 0 });
	listProjects.mockResolvedValue([]);
});

describe('getCommitteeReport', () => {
	it("reads the ledger for the committee's projects only", async () => {
		listProjects.mockResolvedValue([
			{ id: 'p1', name: 'Live room refresh', status: 'in_progress' },
			{ id: 'p2', name: 'Winter showcase', status: 'open' }
		]);
		getProjectBurn.mockResolvedValue(burn(null, 0));

		await getCommitteeReport('g-facilities', { from: '2026-01-01', to: '2026-12-31' });

		expect(listProjects).toHaveBeenCalledWith({ groupId: 'g-facilities' });
		expect(totalsByKindAndCategory).toHaveBeenCalledWith(expect.any(Object), {
			projectIds: ['p1', 'p2']
		});
		expect(getVolunteerTotals).toHaveBeenCalledWith(
			{ from: '2026-01-01', to: '2026-12-31' },
			{ groupId: 'g-facilities' }
		);
	});

	it("lines up each project's budget against its cash burn", async () => {
		listProjects.mockResolvedValue([
			{ id: 'p1', name: 'Live room refresh', status: 'in_progress' }
		]);
		getProjectBurn.mockResolvedValue(burn(50_000, 12_500));

		const report = await getCommitteeReport('g-facilities', {});

		expect(report.projects).toEqual([
			{
				id: 'p1',
				name: 'Live room refresh',
				status: 'in_progress',
				budgetCents: 50_000,
				spentCents: 12_500,
				remainingCents: 37_500
			}
		]);
	});

	it('folds ledger rows into kinds and nets earned against spent', async () => {
		totalsByKindAndCategory.mockResolvedValue([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 3000 },
			{ kind: 'spent', category: 'facility', totalCents: -1200 }
		]);

		const report = await getCommitteeReport('g-booking', {});

		expect(report.money.totalsByKind.earned).toBe(3000);
		expect(report.money.totalsByKind.spent).toBe(-1200);
		expect(report.money.netCents).toBe(1800);
	});
});
