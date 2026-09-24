import { describe, it, expect } from 'vitest';
import { due, earliest, byDeadline, formatIsoDay } from './deadline';

const TODAY = '2026-09-23';

describe('due', () => {
	it('is overdue only once the day has passed', () => {
		expect(due('apply', '2026-09-22', TODAY).overdue).toBe(true);
		expect(due('apply', TODAY, TODAY).overdue).toBe(false);
		expect(due('apply', '2026-09-24', TODAY)).toEqual({
			kind: 'apply',
			on: '2026-09-24',
			overdue: false
		});
	});
});

describe('earliest', () => {
	it('picks the soonest date and skips missing ones', () => {
		const report = due('report', '2026-11-01', TODAY);
		const end = due('end', '2027-01-01', TODAY);
		expect(earliest(end, null, report)).toBe(report);
		expect(earliest(null, null)).toBeNull();
	});
});

describe('byDeadline', () => {
	it('sorts soonest first, undated last, then by name', () => {
		const rows = [
			{ name: 'b', deadline: null },
			{ name: 'later', deadline: due('end', '2026-12-01', TODAY) },
			{ name: 'a', deadline: null },
			{ name: 'sooner', deadline: due('report', '2026-10-01', TODAY) }
		];
		rows.sort(byDeadline((r) => r.name));
		expect(rows.map((r) => r.name)).toEqual(['sooner', 'later', 'a', 'b']);
	});
});

describe('formatIsoDay', () => {
	it('reads the calendar day, not UTC midnight', () => {
		expect(formatIsoDay('2026-10-01')).toMatch(/Oct 1/);
		expect(formatIsoDay(null)).toBe('—');
	});
});
