import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clubInstant, formatScheduleLabel, formatTimeRange, fullDate } from './format';

// A viewer outside the club's zone: local and club readings of a wall clock
// disagree by three hours, and by a day near midnight.
const zones = ['America/New_York', 'Pacific/Kiritimati'];

describe.each(zones)('clubInstant with the runtime in %s', (zone) => {
	let saved: string | undefined;
	beforeAll(() => {
		saved = process.env.TZ;
		process.env.TZ = zone;
	});
	afterAll(() => {
		if (saved === undefined) delete process.env.TZ;
		else process.env.TZ = saved;
	});

	it('reads the date and time as club wall clock', () => {
		expect(clubInstant('2026-07-15', '19:00').toISOString()).toBe('2026-07-16T02:00:00.000Z');
		expect(clubInstant('2026-01-15', '09:30').toISOString()).toBe('2026-01-15T17:30:00.000Z');
	});

	it('round-trips through the club-time formatters the confirm step uses', () => {
		const start = clubInstant('2026-07-15', '19:00');
		const end = clubInstant('2026-07-15', '21:00');
		expect(fullDate(start)).toBe(fullDate(new Date('2026-07-15T19:00:00-07:00')));
		expect(formatTimeRange(start, end)).toBe(
			formatTimeRange(new Date('2026-07-15T19:00:00-07:00'), new Date('2026-07-15T21:00:00-07:00'))
		);
		expect(formatScheduleLabel('Weekly', clubInstant('2026-07-15', '23:30'))).toBe(
			formatScheduleLabel('Weekly', new Date('2026-07-15T23:30:00-07:00'))
		);
	});
});
