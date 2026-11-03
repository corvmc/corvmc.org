import { describe, it, expect } from 'vitest';
import { recurringSeriesEnd } from './series-until';

describe('recurringSeriesEnd', () => {
	it('is open-ended without an until day, or for a one-off booking', () => {
		expect(recurringSeriesEnd({ recurring: 'weekly', date: '2026-11-10' })).toBeUndefined();
		expect(
			recurringSeriesEnd({ recurring: '', date: '2026-11-10', recurringUntil: '2026-12-01' })
		).toBeUndefined();
	});

	it('ends at the close of the until day, club time', () => {
		const end = recurringSeriesEnd({
			recurring: 'weekly',
			date: '2026-11-10',
			recurringUntil: '2026-12-01'
		});
		expect(end?.toISOString()).toBe('2026-12-02T07:59:00.000Z');
	});

	it('refuses an until day on or before the first session', () => {
		expect(
			recurringSeriesEnd({ recurring: 'weekly', date: '2026-11-10', recurringUntil: '2026-11-10' })
		).toBeNull();
	});
});
