import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/site-config/site-config-service', () => ({
	getConfigsByPrefix: vi.fn(async () => ({
		operatingHoursStart: '09:00',
		operatingHoursEnd: '22:00',
		minDurationHours: 1,
		maxDurationHours: 8,
		timeSlotMinutes: 30,
		bufferMinutes: 0,
		maxAdvanceDaysOneoff: 14,
		maxAdvanceDaysRecurring: 17.5
	}))
}));
import {
	buildRRule,
	parseRRule,
	getOccurrences,
	generationWindowEnd,
	describeFrequency,
	monthlyModeOf
} from './rrule-helpers';
import { DEFAULT_TIMEZONE } from '$lib/config';

describe('buildRRule', () => {
	it('encodes a weekly rule for a Tuesday', () => {
		// 2026-05-12 is a Tuesday, 10:00 AM Pacific (17:00 UTC during PDT)
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rule = parseRRule(buildRRule(start, 'weekly'));

		expect(rule.freq).toBe('weekly');
		expect(rule.interval).toBe(1);
		expect(rule.weekday).toBe(2); // 0=Sun..6=Sat
		expect(rule.tz).toBe(DEFAULT_TIMEZONE);
	});

	it('encodes a biweekly rule with interval 2', () => {
		const rule = parseRRule(buildRRule(new Date('2026-05-12T17:00:00.000Z'), 'biweekly'));

		expect(rule.freq).toBe('weekly');
		expect(rule.interval).toBe(2);
		expect(rule.weekday).toBe(2);
	});

	it('encodes a monthly rule on the 2nd Tuesday', () => {
		// 2026-05-12: day 12, ceil(12/7) = 2 → 2nd Tuesday
		const rule = parseRRule(buildRRule(new Date('2026-05-12T17:00:00.000Z'), 'monthly'));

		expect(rule.freq).toBe('monthly');
		expect(rule.interval).toBe(1);
		expect(rule.weekday).toBe(2);
		expect(rule.nthWeek).toBe(2);
	});

	it('defaults monthly rules to weekday mode', () => {
		const rule = parseRRule(buildRRule(new Date('2026-05-12T17:00:00.000Z'), 'monthly'));

		expect(rule.monthlyMode).toBe('weekday');
		expect(rule.nthWeek).toBe(2);
		expect(rule.dayOfMonth).toBeUndefined();
	});

	it('encodes a monthly rule on a fixed day of the month', () => {
		// 2026-05-20 -> day 20
		const rule = parseRRule(
			buildRRule(new Date('2026-05-20T17:00:00.000Z'), 'monthly', 'monthday')
		);

		expect(rule.freq).toBe('monthly');
		expect(rule.monthlyMode).toBe('monthday');
		expect(rule.dayOfMonth).toBe(20);
		expect(rule.nthWeek).toBeUndefined();
	});

	it('encodes a monthly rule on the 3rd Wednesday', () => {
		// 2026-05-20 is a Wednesday, day 20, ceil(20/7) = 3 → 3rd Wednesday
		const rule = parseRRule(buildRRule(new Date('2026-05-20T17:00:00.000Z'), 'monthly'));

		expect(rule.freq).toBe('monthly');
		expect(rule.weekday).toBe(3);
		expect(rule.nthWeek).toBe(3);
	});

	it('encodes a weekly rule for a Sunday', () => {
		// 2026-05-17 is a Sunday
		const rule = parseRRule(buildRRule(new Date('2026-05-17T19:00:00.000Z'), 'weekly'));

		expect(rule.weekday).toBe(0);
	});

	it('encodes a weekly rule for a Saturday', () => {
		// 2026-05-16 10am PDT (17:00 UTC) is a Saturday
		const rule = parseRRule(buildRRule(new Date('2026-05-16T17:00:00.000Z'), 'weekly'));

		expect(rule.weekday).toBe(6);
	});

	it('captures the start time components in the target timezone', () => {
		const rule = parseRRule(buildRRule(new Date('2026-05-12T17:00:00.000Z'), 'weekly'));

		expect(rule.start.year).toBe(2026);
		expect(rule.start.day).toBe(12);
		expect(rule.start.hour).toBe(10); // 17:00 UTC → 10:00 PDT
		expect(rule.start.minute).toBe(0);
	});
});

describe('parseRRule', () => {
	it('round-trips a built rule string', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rule = parseRRule(buildRRule(start, 'weekly'));

		expect(rule).toBeDefined();
		expect(rule.freq).toBe('weekly');
	});

	it('parses a serialized rule object', () => {
		const rule = parseRRule(
			JSON.stringify({
				freq: 'weekly',
				interval: 1,
				tz: DEFAULT_TIMEZONE,
				start: { year: 2026, month: 5, day: 12, hour: 10, minute: 0 },
				weekday: 2
			})
		);

		expect(rule.freq).toBe('weekly');
		expect(rule.weekday).toBe(2);
	});
});

describe('getOccurrences', () => {
	it('returns occurrences within the given window for a weekly rule', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'weekly');

		const after = new Date('2026-05-12T00:00:00.000Z');
		const before = new Date('2026-06-12T00:00:00.000Z');

		const occurrences = getOccurrences(rruleString, after, before);

		// ~4-5 Tuesdays in a month window
		expect(occurrences.length).toBeGreaterThanOrEqual(4);
		expect(occurrences.length).toBeLessThanOrEqual(5);

		// All occurrences should be Date objects
		for (const occ of occurrences) {
			expect(occ).toBeInstanceOf(Date);
		}
	});

	it('returns occurrences within the given window for a biweekly rule', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'biweekly');

		const after = new Date('2026-05-12T00:00:00.000Z');
		const before = new Date('2026-06-12T00:00:00.000Z');

		const occurrences = getOccurrences(rruleString, after, before);

		// Biweekly in a month = ~2 occurrences
		expect(occurrences.length).toBeGreaterThanOrEqual(2);
		expect(occurrences.length).toBeLessThanOrEqual(3);
	});

	it('returns occurrences within the given window for a monthly rule', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'monthly');

		const after = new Date('2026-05-12T00:00:00.000Z');
		const before = new Date('2026-08-12T00:00:00.000Z');

		const occurrences = getOccurrences(rruleString, after, before);

		// 3 months = 2-4 occurrences depending on nth-weekday alignment
		expect(occurrences.length).toBeGreaterThanOrEqual(2);
		expect(occurrences.length).toBeLessThanOrEqual(4);
	});

	it('lands on the fixed day of the month for monthday rules', () => {
		// Start on the 20th; monthday mode should recur on the 20th each month.
		const start = new Date('2026-05-20T17:00:00.000Z');
		const rruleString = buildRRule(start, 'monthly', 'monthday');

		const after = new Date('2026-05-21T00:00:00.000Z');
		const before = new Date('2026-08-21T00:00:00.000Z');

		const occurrences = getOccurrences(rruleString, after, before);

		expect(occurrences.length).toBeGreaterThanOrEqual(2);
		for (const occ of occurrences) {
			expect(occ.getDate()).toBe(20);
		}
	});

	it('returns empty array when window has no occurrences', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'weekly');

		// Window before the DTSTART
		const after = new Date('2026-01-01T00:00:00.000Z');
		const before = new Date('2026-01-07T00:00:00.000Z');

		const occurrences = getOccurrences(rruleString, after, before);
		expect(occurrences).toHaveLength(0);
	});

	it('excludes boundary dates (exclusive window)', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'weekly');

		// Use exact occurrence time as boundary — should be excluded
		const after = new Date('2026-05-12T17:00:00.000Z');
		const before = new Date('2026-05-19T17:00:00.000Z');

		const occurrences = getOccurrences(rruleString, after, before);

		// Both boundaries are exclusive, so neither May 12 nor May 19 should be included
		expect(
			occurrences.every(
				(occ) => occ.getTime() !== after.getTime() && occ.getTime() !== before.getTime()
			)
		).toBe(true);
	});
});

describe('generationWindowEnd', () => {
	it('returns a date MAX_ADVANCE_DAYS_RECURRING days in the future', async () => {
		const from = new Date('2026-05-12T00:00:00.000Z');
		const result = await generationWindowEnd(from);

		const expectedMs = from.getTime() + 17.5 * 24 * 60 * 60 * 1000;
		expect(result.getTime()).toBe(expectedMs);
	});

	it('generates a teaching series further out than a member one', async () => {
		// Not a courtesy — it is what stops a teacher losing the slot they teach in
		// every week. A teaching series is Tier 2 in the generator and can be
		// waitlisted behind a member's one-off, and the mitigation is that the
		// series already exists before a member can reach that week.
		const from = new Date('2026-05-12T00:00:00.000Z');
		const teaching = await generationWindowEnd(from, 'instructor');
		const member = await generationWindowEnd(from, 'user');

		expect(teaching.getTime()).toBeGreaterThan(member.getTime());
		expect(teaching.getTime()).toBe(from.getTime() + 90 * 24 * 60 * 60 * 1000);
	});

	it('gives every other booker type the member window', async () => {
		// Positively matched, so a booker type added later inherits the member
		// horizon rather than silently acquiring the teaching one.
		const from = new Date('2026-05-12T00:00:00.000Z');
		for (const t of ['user', 'group', 'event'] as const) {
			expect((await generationWindowEnd(from, t)).getTime()).toBe(
				from.getTime() + 17.5 * 24 * 60 * 60 * 1000
			);
		}
	});

	it('defaults to current time when no argument is given', async () => {
		const before = new Date();
		const result = await generationWindowEnd();
		const after = new Date();

		const minExpected = before.getTime() + 17.5 * 24 * 60 * 60 * 1000;
		const maxExpected = after.getTime() + 17.5 * 24 * 60 * 60 * 1000;

		expect(result.getTime()).toBeGreaterThanOrEqual(minExpected);
		expect(result.getTime()).toBeLessThanOrEqual(maxExpected);
	});
});

describe('describeFrequency', () => {
	it('returns "Weekly" for a weekly rule', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'weekly');

		expect(describeFrequency(rruleString)).toBe('Weekly');
	});

	it('returns "Every 2 weeks" for a biweekly rule', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'biweekly');

		expect(describeFrequency(rruleString)).toBe('Every 2 weeks');
	});

	it('returns "Monthly" for a monthly rule', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		const rruleString = buildRRule(start, 'monthly');

		expect(describeFrequency(rruleString)).toBe('Monthly');
	});
});

describe('monthlyModeOf', () => {
	it('returns null for non-monthly rules', () => {
		const start = new Date('2026-05-12T17:00:00.000Z');
		expect(monthlyModeOf(buildRRule(start, 'weekly'))).toBeNull();
		expect(monthlyModeOf(buildRRule(start, 'biweekly'))).toBeNull();
	});

	it('returns the monthly mode for monthly rules', () => {
		const start = new Date('2026-05-20T17:00:00.000Z');
		expect(monthlyModeOf(buildRRule(start, 'monthly'))).toBe('weekday');
		expect(monthlyModeOf(buildRRule(start, 'monthly', 'monthday'))).toBe('monthday');
	});
});
