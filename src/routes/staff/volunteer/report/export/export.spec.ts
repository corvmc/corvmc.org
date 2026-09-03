import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The volunteer hours CSV.
 *
 * Worth pinning because this endpoint is an exception to the app's usual shape:
 * a download needs a `Content-Disposition` header, so it is a `+server.ts`
 * rather than a remote function — which makes it one of the few places where
 * the guard is *not* the remote-function boundary.
 */

const requireStaff = vi.fn(async () => undefined);
vi.mock('$lib/server/authorization', () => ({
	requireStaff: () => requireStaff()
}));

let exportRows: unknown[] = [];
const listApprovedHoursForExport = vi.fn(async () => exportRows);
vi.mock('$lib/server/volunteer/volunteer-report-service', () => ({
	listApprovedHoursForExport: (...a: unknown[]) => listApprovedHoursForExport(...(a as []))
}));

const HOUR_VALUE_CENTS = 3766;
vi.mock('$lib/server/volunteer/hour-value', () => ({
	getHourValueCents: vi.fn(async () => HOUR_VALUE_CENTS),
	getHourValueSource: vi.fn(async () => 'Independent Sector, Oregon, 2025')
}));

import { GET } from './+server';

function row(over: Record<string, unknown> = {}) {
	return {
		memberName: 'Jordan Martinez',
		memberEmail: 'jordan@example.com',
		roleName: 'Front Desk',
		isSpecializedSkill: false,
		marketRateCents: null,
		workedOn: new Date('2026-07-04T19:00:00Z'),
		minutes: 240,
		description: null,
		...over
	};
}

const call = (query = '') =>
	GET({ url: new URL(`http://localhost/staff/volunteer/report/export${query}`) } as never);

async function body(query = '') {
	return (await call(query)).text();
}

beforeEach(() => {
	vi.clearAllMocks();
	requireStaff.mockResolvedValue(undefined);
	exportRows = [];
});

describe('the volunteer hours export', () => {
	it('guards before reading anything', async () => {
		requireStaff.mockRejectedValue(new Error('403: Staff access required'));

		await expect(call()).rejects.toThrow('Staff access required');
		expect(listApprovedHoursForExport).not.toHaveBeenCalled();
	});

	it('passes the range through, and omits absent bounds', async () => {
		await call('?from=2026-07-01&to=2026-07-31');
		expect(listApprovedHoursForExport).toHaveBeenCalledWith({
			from: '2026-07-01',
			to: '2026-07-31'
		});

		await call();
		expect(listApprovedHoursForExport).toHaveBeenLastCalledWith({
			from: undefined,
			to: undefined
		});
	});

	it('refuses a malformed date rather than silently exporting everything', async () => {
		await expect(call('?from=july')).rejects.toThrow();
	});

	it('values an ordinary hour at the impact rate and leaves recognizable blank', async () => {
		exportRows = [row({ minutes: 60 })];

		const [, data] = (await body()).trim().split('\n').slice(1);

		expect(data).toContain('37.66');
		// Blank, not 0.00: zero claims the hour was worth nothing, where the
		// truth is that it is not a specialized skill at all.
		expect(data.split(',').at(-2)).toBe('');
	});

	it('leaves recognizable blank for a specialized role nobody has priced', async () => {
		exportRows = [row({ isSpecializedSkill: true, marketRateCents: null, minutes: 60 })];

		const data = (await body()).trim().split('\n').at(-1)!;

		expect(data).toContain('yes');
		expect(data.split(',').at(-2)).toBe('');
	});

	it('values a priced specialized role at its own rate, beside the impact figure', async () => {
		exportRows = [row({ isSpecializedSkill: true, marketRateCents: 6500, minutes: 120 })];

		const data = (await body()).trim().split('\n').at(-1)!;

		// $130.00 at the role rate, $75.32 at the impact rate — two answers to
		// two questions, in two columns, on one row.
		expect(data).toContain('130.00');
		expect(data).toContain('75.32');
	});

	it('carries the rate and its provenance in the file itself', async () => {
		exportRows = [row()];

		// The file outlives the page it came from. A funder-facing number
		// separated from the rate that produced it cannot be checked.
		expect(await body()).toContain(
			'# Impact value at $37.66/hr — Independent Sector, Oregon, 2025'
		);
	});

	it('writes no total row, because the two value columns must not be added', async () => {
		exportRows = [row(), row({ isSpecializedSkill: true, marketRateCents: 6500 })];

		const lines = (await body()).trim().split('\n');

		// Comment, header, two data rows. A footer would invite summing across
		// columns that overlap, which double-counts every specialized hour.
		expect(lines).toHaveLength(4);
		expect(lines.at(-1)).toContain('@example.com');
	});

	it('writes ISO dates a spreadsheet can sort', async () => {
		exportRows = [row({ workedOn: new Date('2026-07-04T19:00:00Z') })];
		expect(await body()).toContain('2026-07-04');
	});

	it('names the download after the range it covers', async () => {
		const res = await call('?from=2026-07-01&to=2026-07-31');
		expect(res.headers.get('content-disposition')).toContain(
			'volunteer-hours_2026-07-01_2026-07-31.csv'
		);
	});
});
