import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { asDateValue } from './date-value';

// The save path in projects.remote.ts: the submitted day anchored at noon, club time.
const save = (ymd: string) => buildDateInTz(ymd, '12:00', DEFAULT_TIMEZONE);

describe('asDateValue (#1919)', () => {
	// Aug 20, 7pm Pacific — already Aug 21 in UTC, as prod projects are stored.
	const EVENING_PACIFIC = new Date('2026-08-21T02:00:00Z');

	it('prefills the venue day, not the UTC day', () => {
		expect(asDateValue(EVENING_PACIFIC)).toBe('2026-08-20');
	});

	it('round-trips through save without moving the day', () => {
		const saved = save(asDateValue(EVENING_PACIFIC));
		expect(asDateValue(saved)).toBe('2026-08-20');
		expect(saved.toISOString()).toBe('2026-08-20T19:00:00.000Z');
	});

	it('leaves a missing date empty', () => {
		expect(asDateValue(null)).toBe('');
	});
});
