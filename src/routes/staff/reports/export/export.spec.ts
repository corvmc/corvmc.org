import { describe, it, expect, vi } from 'vitest';

/**
 * The annual report CSV.
 *
 * Two things worth pinning. The guard is here rather than at a remote-function
 * boundary, because a download needs `Content-Disposition` and a `query()`
 * cannot set one. And the caveats are in the file itself: this outlives the
 * page that produced it and gets read by someone who never saw the banner.
 */

const requireCapability = vi.fn(async () => undefined);
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (...a: unknown[]) => requireCapability(...(a as []))
}));

const report = {
	range: {},
	coverage: { startsAt: new Date('2025-03-04T00:00:00Z'), complete: false },
	money: {
		byKind: {
			earned: [
				{ category: 'membership', totalCents: 749_001 },
				{ category: 'ticket_sales', totalCents: 20_288 }
			],
			spent: [{ category: 'card_fees', totalCents: 4321 }],
			in_kind: [{ category: 'equipment', totalCents: 12_500 }],
			pass_through: [{ category: 'act_payout', totalCents: 47_350 }]
		},
		totalsByKind: { earned: 769_289, spent: 4321, in_kind: 12_500, pass_through: 47_350 },
		netCents: 764_968
	},
	volunteering: {
		totals: { totalMinutes: 600, volunteerCount: 4, logCount: 9 },
		contributed: {
			impactValueCents: 5000,
			recognizableServicesCents: 2000,
			unpricedSpecializedMinutes: 0,
			rateCents: 3400,
			rateSource: 'test'
		}
	},
	membership: { sustainingMemberCount: 12, totalFreeHoursAllocated: 48, participationPercent: 30 },
	events: {
		cmcByKind: { show: 3, work_party: 1, meeting: 0, class: 0 },
		cmcTotal: 4,
		bandListings: 2,
		communityListings: 1,
		cancelled: 0
	},
	room: { sessions: 20, hours: 44, distinctBookers: 7, noShows: 1 }
};

const getAnnualReport = vi.fn(async () => report);
vi.mock('$lib/server/report/annual-report-service', () => ({
	getAnnualReport: (...a: unknown[]) => getAnnualReport(...(a as []))
}));

import { GET } from './+server';

const call = (query = '') =>
	GET({ url: new URL(`http://localhost/staff/reports/export${query}`) } as never);

const body = async (query = '') => (await call(query)).text();

describe('the guard', () => {
	it('asks for finance.read before reading anything', async () => {
		await call();
		expect(requireCapability).toHaveBeenCalledWith('finance.read');
	});
});

describe('the file', () => {
	it('downloads under a name that names the range', async () => {
		const res = await call('?from=2026-01-01&to=2026-12-31');
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="cmc-report_2026-01-01_2026-12-31.csv"'
		);
	});

	it('carries the caveats a reader of the file alone would not have', async () => {
		const csv = await body();
		expect(csv).toContain('# Financial record begins 2025-03-04');
		expect(csv).toContain('do not add them');
		expect(csv).toContain('as of the download');
	});

	it('writes dollars, not cents', async () => {
		const csv = await body();
		expect(csv).toContain('Memberships,7490.01,dollars');
	});

	it('labels every value with its unit, because the sections do not share one', async () => {
		const csv = await body();
		expect(csv).toContain('Practice room,Hours booked,44,hours');
		expect(csv).toContain('Practice room,Sessions,20,count');
	});

	it('totals each kind separately and never across them', async () => {
		const csv = await body();
		expect(csv).toContain('Earned,Total,7692.89,dollars');
		expect(csv).toContain('Pass-through,Total,473.50,dollars');
		expect(csv).toContain('Net,Earned less spent,7649.68,dollars');
	});

	it('keeps both volunteer valuations, so neither is mistaken for the other', async () => {
		const csv = await body();
		expect(csv).toContain('Donated time,Impact value,50.00,dollars');
		expect(csv).toContain('Donated time,Contributed services,20.00,dollars');
	});

	it('refuses a range that is not a date', async () => {
		await expect(body('?from=last-tuesday')).rejects.toThrow();
	});
});
