import { describe, expect, it } from 'vitest';
import { groupReservationsByMonth } from './reservation-groups';

const at = (iso: string) => ({ startsAt: new Date(iso) });

describe('groupReservationsByMonth', () => {
	it('returns nothing for an empty history', () => {
		expect(groupReservationsByMonth([])).toEqual([]);
	});

	it('keeps a run of one month in one section', () => {
		const rows = [at('2026-05-04T18:00:00Z'), at('2026-05-18T18:00:00Z')];
		const groups = groupReservationsByMonth(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0][0]).toBe('May 2026');
		expect(groups[0][1]).toEqual(rows);
	});

	it('breaks on the month and preserves input order', () => {
		const groups = groupReservationsByMonth([
			at('2026-05-18T18:00:00Z'),
			at('2026-04-20T18:00:00Z'),
			at('2026-04-06T18:00:00Z')
		]);
		expect(groups.map(([label, rows]) => [label, rows.length])).toEqual([
			['May 2026', 1],
			['April 2026', 2]
		]);
	});

	it('separates the same month in different years', () => {
		const groups = groupReservationsByMonth([
			at('2026-05-04T18:00:00Z'),
			at('2025-05-05T18:00:00Z')
		]);
		expect(groups.map(([label]) => label)).toEqual(['May 2026', 'May 2025']);
	});

	it('reopens a month that the list comes back to', () => {
		const groups = groupReservationsByMonth([
			at('2026-05-04T18:00:00Z'),
			at('2026-04-20T18:00:00Z'),
			at('2026-05-18T18:00:00Z')
		]);
		expect(groups.map(([label]) => label)).toEqual(['May 2026', 'April 2026', 'May 2026']);
	});

	it('files a late-night booking under the venue month, not UTC', () => {
		// 2026-06-01T02:00Z is May 31, 7pm in venue time.
		const groups = groupReservationsByMonth([at('2026-06-01T02:00:00Z')]);
		expect(groups[0][0]).toBe('May 2026');
	});
});
