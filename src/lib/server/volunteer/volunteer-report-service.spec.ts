import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];

/** Captures every WHERE the service builds, so the approved-only filter can be asserted. */
const whereCalls: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			if (prop === 'where') {
				return (condition: unknown) => {
					whereCalls.push(condition);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(() => chainable()) }
}));

import {
	getVolunteerTotals,
	getHoursByMember,
	getHoursByRole,
	getHoursByMonth
} from './volunteer-report-service';

/**
 * Flattens a drizzle SQL condition to the column names and bound values it
 * embeds. Walking `queryChunks` rather than serializing: the objects hold
 * table↔column back-references, so JSON.stringify hits a cycle.
 */
function conditionText(condition: unknown): string {
	const parts: string[] = [];

	function walk(node: any) {
		if (node == null) return;
		if (Array.isArray(node)) return node.forEach(walk);
		if (Array.isArray(node.queryChunks)) return node.queryChunks.forEach(walk);
		// StringChunk
		if (Array.isArray(node.value)) return parts.push(node.value.join(''));
		// Column
		if (typeof node.name === 'string') return parts.push(node.name);
		// Param
		if ('value' in node) return parts.push(String(node.value));
	}

	walk(condition);
	return parts.join(' ');
}

describe('VolunteerReportService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResult = [];
		selectResultQueue = [];
		whereCalls.length = 0;
	});

	// Every rollup filters to approved. That is the entire purpose of the review
	// step — a member can claim anything, and this report has to hold up to a
	// funder.
	describe('approved-only filtering', () => {
		it.each([
			['getVolunteerTotals', () => getVolunteerTotals()],
			['getHoursByRole', () => getHoursByRole()],
			['getHoursByMonth', () => getHoursByMonth()],
			['getHoursByMember', () => getHoursByMember()]
		])('%s filters to approved hours', async (_label, run) => {
			await run();
			expect(whereCalls.length).toBeGreaterThan(0);
			expect(conditionText(whereCalls[0])).toContain('approved');
		});
	});

	describe('getVolunteerTotals', () => {
		it('coerces the aggregate row to numbers', async () => {
			selectResult = [{ totalMinutes: '480', volunteerCount: '3', logCount: '5' }];
			const totals = await getVolunteerTotals();
			expect(totals).toEqual({ totalMinutes: 480, volunteerCount: 3, logCount: 5 });
		});

		// An empty range is a legitimate answer, not an error — the report renders
		// zeros rather than blowing up on a quarter nobody volunteered in.
		it('returns zeros for an empty range, not nulls', async () => {
			selectResult = [];
			const totals = await getVolunteerTotals({ from: '2020-01-01', to: '2020-01-02' });
			expect(totals).toEqual({ totalMinutes: 0, volunteerCount: 0, logCount: 0 });
		});

		it('applies both ends of the date range', async () => {
			selectResult = [{ totalMinutes: 0, volunteerCount: 0, logCount: 0 }];
			await getVolunteerTotals({ from: '2026-01-01', to: '2026-03-31' });
			// status + from + to
			expect(conditionText(whereCalls[0]).match(/worked_on/g)?.length).toBe(2);
		});
	});

	describe('getHoursByMember', () => {
		it('groups by user and converts the max timestamp back to a Date', async () => {
			const workedOnSeconds = 1_770_000_000;
			selectResultQueue = [
				[
					{
						userId: 'u1',
						member: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
						minutes: '300',
						logCount: '3',
						lastWorkedOn: workedOnSeconds
					}
				],
				[{ count: 1 }]
			];

			const result = await getHoursByMember();
			expect(result.rows[0]).toMatchObject({
				userId: 'u1',
				member: { type: 'member', id: 'u1', title: 'Ada', subtitle: 'ada@example.com' },
				minutes: 300,
				logCount: 3,
				lastWorkedOn: new Date(workedOnSeconds * 1000)
			});
		});

		// Under GROUP BY, a plain count() counts log rows rather than groups and
		// would inflate totalPages — the count query has to be count(distinct).
		it('paginates on distinct members, not on log rows', async () => {
			selectResultQueue = [
				[
					{
						userId: 'u1',
						member: { id: 'u1', name: 'Ada', email: 'a@e.com' },
						minutes: 60,
						logCount: 9,
						lastWorkedOn: 1_770_000_000
					}
				],
				[{ count: 1 }]
			];

			const result = await getHoursByMember({}, { page: 1, pageSize: 50 });
			expect(result.pagination.total).toBe(1);
			expect(result.pagination.totalPages).toBe(1);
		});
	});

	describe('getHoursByRole', () => {
		// Retiring a role does not un-happen the work done under it. A report that
		// silently dropped archived roles would understate the total.
		it('keeps archived roles in the rollup', async () => {
			selectResult = [
				{
					volunteerRoleId: 'r1',
					roleName: 'Zine & Print',
					roleIsActive: false,
					minutes: '240',
					logCount: '2'
				}
			];

			const rows = await getHoursByRole();
			expect(rows).toEqual([
				{
					volunteerRoleId: 'r1',
					roleName: 'Zine & Print',
					roleIsActive: false,
					minutes: 240,
					logCount: 2
				}
			]);
		});
	});

	describe('getHoursByMonth', () => {
		it('returns YYYY-MM buckets with numeric totals', async () => {
			selectResult = [
				{ month: '2026-01', minutes: '600', logCount: '4' },
				{ month: '2026-02', minutes: '180', logCount: '1' }
			];

			const rows = await getHoursByMonth();
			expect(rows).toEqual([
				{ month: '2026-01', minutes: 600, logCount: 4 },
				{ month: '2026-02', minutes: 180, logCount: 1 }
			]);
		});

		it('returns an empty array when nothing was approved', async () => {
			selectResult = [];
			await expect(getHoursByMonth()).resolves.toEqual([]);
		});
	});
});
