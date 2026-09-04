import { describe, it, expect } from 'vitest';
import { snoozePresets } from './snooze-presets';

/**
 * The options are derived from four different date arithmetics off one `now`,
 * and two of them meet on some weekdays: on a Friday `now + 3` *is* next
 * Monday, and on a Sunday next Monday *is* tomorrow. The menu keys its rows by
 * the date, so a collision was not a cosmetic duplicate — it threw
 * `each_key_duplicate` and took the whole menu down, on those days only.
 */
describe('snooze presets', () => {
	const values = (iso: string) => snoozePresets(new Date(iso)).map((p) => p.value);
	const labels = (iso: string) => snoozePresets(new Date(iso)).map((p) => p.label);

	it.each([
		['Monday', '2026-09-07T10:00:00'],
		['Tuesday', '2026-09-08T10:00:00'],
		['Wednesday', '2026-09-09T10:00:00'],
		['Thursday', '2026-09-10T10:00:00'],
		['Friday', '2026-09-04T10:00:00'],
		['Saturday', '2026-09-05T10:00:00'],
		['Sunday', '2026-09-06T10:00:00']
	])('offers no two options on the same day, on a %s', (_day, iso) => {
		const dates = values(iso);
		expect(new Set(dates).size).toBe(dates.length);
	});

	it('drops "Later this week" once it would land in the next one', () => {
		// Friday + 3 is Monday.
		expect(labels('2026-09-04T10:00:00')).not.toContain('Later this week');
		expect(labels('2026-09-08T10:00:00')).toContain('Later this week');
	});

	it('drops "Next week" on the Sunday when it is just tomorrow', () => {
		expect(labels('2026-09-06T10:00:00')).not.toContain('Next week');
		expect(labels('2026-09-06T10:00:00')).toContain('Tomorrow');
	});

	it('always offers tomorrow and the fortnight', () => {
		for (const iso of ['2026-09-04T10:00:00', '2026-09-06T10:00:00', '2026-09-08T10:00:00']) {
			expect(labels(iso)).toEqual(expect.arrayContaining(['Tomorrow', 'In two weeks']));
		}
	});
});
