import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The overlap and status predicates are SQL, so they run against real rows.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});
vi.mock('$lib/server/db', () => ({ db: testDb }));

// The `teaching*` keys are fixtures, not decoration: without them `termsFor`
// falls through to the DEFAULT_TEACHING_* constants and an instructor case
// would be asserting against the module's own defaults rather than against
// anything this mock controls.
vi.mock('$lib/server/site-config/site-config-service', () => ({
	getConfigsByPrefix: vi.fn(async () => ({
		operatingHoursStart: '09:00',
		operatingHoursEnd: '22:00',
		minDurationHours: 1,
		maxDurationHours: 8,
		timeSlotMinutes: 30,
		bufferMinutes: 0,
		minAdvanceMinutes: 60,
		maxAdvanceDaysOneoff: 14,
		maxAdvanceDaysRecurring: 17.5,
		teachingMinDurationHours: 0.5,
		teachingMaxAdvanceDaysOneoff: 60,
		teachingMaxAdvanceDaysRecurring: 90
	}))
}));

import {
	hasConflict,
	getAvailableSlots,
	getAvailableSlotsForDates,
	validateBooking,
	getConflictDetails,
	getValidationWarnings
} from './conflict-service';
import { buildDateInTz } from './timezone';
import { addCalendarDays, forEachClockEdge, viewerTimeZones } from '$lib/test/clock-edges';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Pacific wall-clock time at the offset in force that day. A fixed -07:00 put
// every winter fixture an hour early, and the relative-date cases cross DST (#1960).
function makeDate(dateStr: string, timeStr: string): Date {
	return buildDateInTz(dateStr, timeStr, 'America/Los_Angeles');
}

const date = '2025-07-15'; // A Tuesday in PDT

const secs = (d: Date) => Math.floor(d.getTime() / 1000);
let seq = 0;
function booking(startsAt: Date, endsAt: Date, opts: { status?: string; id?: string } = {}) {
	const id = opts.id ?? `res-${++seq}`;
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 values (?, 'user', 'u-alice', 'u-alice', ?, ?, ?)`
		)
		.run(id, opts.status ?? 'confirmed', secs(startsAt), secs(endsAt));
	return id;
}
function closed(startsAt: Date, endsAt: Date, reason = 'Maintenance') {
	sqlite
		.prepare(`insert into closure (id, reason, starts_at, ends_at) values (?, ?, ?, ?)`)
		.run(`closure-${++seq}`, reason, secs(startsAt), secs(endsAt));
}

beforeEach(() => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from closure');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email) values ('u-alice', 'Alice', 'alice@example.com'), ('u-bob', 'Bob', 'bob@example.com')`
	);
});

// ---------------------------------------------------------------------------
// validateBooking — now async, reads config from DB
// ---------------------------------------------------------------------------

describe('validateBooking', () => {
	// `date` is fixed, so the clock is too: five days before it, which keeps every
	// fixed-date case clear of the minimum notice and inside the advance window.
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2025-07-10T12:00:00-07:00'));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	describe('minimum notice (#1721)', () => {
		// 09:40 on the booking day: a 10:00 start is 20 minutes out, 11:00 is 80.
		beforeEach(() => vi.setSystemTime(new Date(`${date}T09:40:00-07:00`)));

		it('rejects a start inside the notice window, for every self-service booker', async () => {
			for (const bookerType of ['user', 'group', 'instructor'] as const) {
				const result = await validateBooking(makeDate(date, '10:00'), makeDate(date, '11:00'), {
					bookerType
				});
				expect(result.code, bookerType).toBe('TOO_SOON');
			}
		});

		it('rejects a start in the past', async () => {
			const result = await validateBooking(makeDate(date, '09:00'), makeDate(date, '10:00'));
			expect(result.valid).toBe(false);
			expect(result.code).toBe('TOO_SOON');
		});

		it('accepts a start at or beyond the notice', async () => {
			vi.setSystemTime(new Date(`${date}T10:00:00-07:00`));
			const result = await validateBooking(makeDate(date, '11:00'), makeDate(date, '12:00'));
			expect(result).toEqual({ valid: true });
		});
	});

	it('accepts a valid 1-hour booking within operating hours', async () => {
		const result = await validateBooking(makeDate(date, '10:00'), makeDate(date, '11:00'));
		expect(result).toEqual({ valid: true });
	});

	it('accepts a valid 8-hour booking', async () => {
		const result = await validateBooking(makeDate(date, '09:00'), makeDate(date, '17:00'));
		expect(result).toEqual({ valid: true });
	});

	it('accepts a booking ending exactly at operating hours end', async () => {
		const result = await validateBooking(makeDate(date, '21:00'), makeDate(date, '22:00'));
		expect(result).toEqual({ valid: true });
	});

	it('rejects end time before start time', async () => {
		const result = await validateBooking(makeDate(date, '11:00'), makeDate(date, '10:00'));
		expect(result.valid).toBe(false);
		expect(result.code).toBe('END_BEFORE_START');
	});

	it('rejects duration shorter than minimum', async () => {
		const result = await validateBooking(makeDate(date, '10:00'), makeDate(date, '10:30'));
		expect(result.valid).toBe(false);
		expect(result.code).toBe('MIN_DURATION');
	});

	/**
	 * Instructor terms, which nothing in this file exercised: every call passed
	 * `(startsAt, endsAt)` and so only ever took `termsFor`'s default `'user'`
	 * branch. A teaching lesson is half an hour and books a term ahead, and both
	 * halves were unguarded here.
	 */
	it('accepts a 30-minute booking for an instructor — the member minimum is not theirs', async () => {
		const result = await validateBooking(makeDate(date, '10:00'), makeDate(date, '10:30'), {
			bookerType: 'instructor'
		});
		expect(result).toEqual({ valid: true });
	});

	it('still rejects a 30-minute booking for everyone else', async () => {
		for (const bookerType of ['user', 'group', 'production'] as const) {
			const result = await validateBooking(makeDate(date, '10:00'), makeDate(date, '10:30'), {
				bookerType
			});
			expect(result.code, bookerType).toBe('MIN_DURATION');
		}
	});

	it('lets an instructor book a term ahead, where a member is capped at two weeks', async () => {
		const farOff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		farOff.setUTCHours(18, 0, 0, 0);
		const end = new Date(farOff.getTime() + 60 * 60 * 1000);

		expect((await validateBooking(farOff, end)).code).toBe('TOO_FAR_AHEAD');
		expect(await validateBooking(farOff, end, { bookerType: 'instructor' })).toEqual({
			valid: true
		});
	});

	it('rejects duration longer than maximum', async () => {
		const result = await validateBooking(makeDate(date, '09:00'), makeDate(date, '18:00'));
		expect(result.valid).toBe(false);
		expect(result.code).toBe('MAX_DURATION');
	});

	it('rejects start time not on 30-minute boundary', async () => {
		const result = await validateBooking(makeDate(date, '10:15'), makeDate(date, '11:15'));
		expect(result.valid).toBe(false);
		expect(result.code).toBe('SLOT_BOUNDARY');
	});

	it('rejects start time before operating hours', async () => {
		const result = await validateBooking(makeDate(date, '08:00'), makeDate(date, '09:00'));
		expect(result.valid).toBe(false);
		expect(result.code).toBe('BEFORE_OPENING');
	});

	it('rejects end time after operating hours', async () => {
		const result = await validateBooking(makeDate(date, '21:00'), makeDate(date, '23:00'));
		expect(result.valid).toBe(false);
		expect(result.code).toBe('AFTER_CLOSING');
	});

	it('accepts half-hour boundaries', async () => {
		const result = await validateBooking(makeDate(date, '10:30'), makeDate(date, '12:00'));
		expect(result).toEqual({ valid: true });
	});

	it('rejects booking too far in advance (one-off)', async () => {
		const farFuture = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days ahead
		const dateStr = farFuture.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
		const start = makeDate(dateStr, '10:00');
		const end = makeDate(dateStr, '11:00');
		const result = await validateBooking(start, end);
		expect(result.valid).toBe(false);
		expect(result.code).toBe('TOO_FAR_AHEAD');
	});

	it('accepts booking within recurring advance window', async () => {
		const future = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000); // 16 days ahead
		const dateStr = future.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
		const start = makeDate(dateStr, '10:00');
		const end = makeDate(dateStr, '11:00');
		const result = await validateBooking(start, end, { isRecurring: true });
		expect(result).toEqual({ valid: true });
	});
});

// ---------------------------------------------------------------------------
// hasConflict — against real rows
// ---------------------------------------------------------------------------

describe('hasConflict', () => {
	const at = (start: string, end: string) =>
		hasConflict(makeDate(date, start), makeDate(date, end));

	it('returns false when no reservations or closures conflict', async () => {
		// Touching end to start is not an overlap.
		booking(makeDate(date, '09:00'), makeDate(date, '10:00'));
		booking(makeDate(date, '11:00'), makeDate(date, '12:00'));
		expect(await at('10:00', '11:00')).toBe(false);
	});

	it('returns true when a reservation overlaps', async () => {
		booking(makeDate(date, '10:30'), makeDate(date, '11:30'));
		expect(await at('10:00', '11:00')).toBe(true);
	});

	it.each(['cancelled', 'waitlisted'])('ignores a %s reservation', async (status) => {
		booking(makeDate(date, '10:00'), makeDate(date, '11:00'), { status });
		expect(await at('10:00', '11:00')).toBe(false);
	});

	it('returns true when a closure overlaps', async () => {
		closed(makeDate(date, '10:45'), makeDate(date, '13:00'));
		expect(await at('10:00', '11:00')).toBe(true);
	});

	it('does not count the excluded reservation against itself', async () => {
		const id = booking(makeDate(date, '10:00'), makeDate(date, '11:00'));
		expect(await hasConflict(makeDate(date, '10:00'), makeDate(date, '11:00'), id)).toBe(false);
		booking(makeDate(date, '10:00'), makeDate(date, '11:00'));
		expect(await hasConflict(makeDate(date, '10:00'), makeDate(date, '11:00'), id)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// getAvailableSlots — against real rows
// ---------------------------------------------------------------------------

describe('getAvailableSlots', () => {
	// getAvailableSlots marks slots before `now + minAdvanceMinutes` as unavailable,
	// so use a date several days in the future to keep the whole operating window valid.
	const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
		timeZone: 'America/Los_Angeles'
	});

	// Regression: the day is anchored to the literal date string, whatever the
	// process zone. A `Date` parsed at runtime-zone midnight (UTC on Workers) put
	// the slots on the previous club day, so today's staff view showed every slot
	// as already past ("all blocked") and open slots were refused on submit.
	forEachClockEdge(
		'marks a slot open exactly when it clears the notice, today and tomorrow',
		async ({ at, clubDate }) => {
			const earliest = at.getTime() + 60 * 60_000; // minAdvanceMinutes
			for (const day of [clubDate, addCalendarDays(clubDate, 1)]) {
				const slots = await getAvailableSlots(day);

				expect(slots).toHaveLength(26);
				expect(slots[0].startTime).toBe('09:00');
				expect(slots.map((s) => s.available)).toEqual(
					slots.map((s) => makeDate(day, s.startTime).getTime() >= earliest)
				);
			}
		},
		{ fakeTimers: true, zones: viewerTimeZones }
	);

	it('returns slots within operating hours when no reservations or closures', async () => {
		const slots = await getAvailableSlots(futureDate);
		// Operating hours 09:00 - 22:00 = 13 hours = 26 half-hour slots
		expect(slots).toHaveLength(26);
		expect(slots[0].startTime).toBe('09:00');
		expect(slots[0].available).toBe(true);
		expect(slots[25].endTime).toBe('22:00');
		expect(slots[25].available).toBe(true);
	});

	it('marks slots overlapping a reservation as unavailable', async () => {
		const resStart = makeDate(futureDate, '10:00');
		const resEnd = makeDate(futureDate, '11:00');
		booking(resStart, resEnd);
		const slots = await getAvailableSlots(futureDate);
		// Slots at 10:00 and 10:30 should be blocked
		const slot1000 = slots.find((s) => s.startTime === '10:00');
		const slot1030 = slots.find((s) => s.startTime === '10:30');
		expect(slot1000?.available).toBe(false);
		expect(slot1030?.available).toBe(false);
		// Slot at 09:00 should be free
		const slot0900 = slots.find((s) => s.startTime === '09:00');
		expect(slot0900?.available).toBe(true);
	});

	it('marks slots overlapping a closure as unavailable', async () => {
		const closureStart = makeDate(futureDate, '14:00');
		const closureEnd = makeDate(futureDate, '15:30');
		closed(closureStart, closureEnd);
		const slots = await getAvailableSlots(futureDate);
		const slot1400 = slots.find((s) => s.startTime === '14:00');
		const slot1430 = slots.find((s) => s.startTime === '14:30');
		const slot1500 = slots.find((s) => s.startTime === '15:00');
		expect(slot1400?.available).toBe(false);
		expect(slot1430?.available).toBe(false);
		expect(slot1500?.available).toBe(false);
		// Slot before closure should be available
		const slot1330 = slots.find((s) => s.startTime === '13:30');
		expect(slot1330?.available).toBe(true);
	});
});

describe('getAvailableSlotsForDates', () => {
	const day1 = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString('en-CA', {
		timeZone: 'America/Los_Angeles'
	});
	// The next calendar day, not +24h: across a DST change that lands on the same date.
	const day2 = new Date(Date.parse(`${day1}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

	it('reads the range once and applies each row only to its own day', async () => {
		booking(makeDate(day2, '10:00'), makeDate(day2, '11:00'));
		const select = vi.spyOn(testDb, 'select');
		const byDate = await getAvailableSlotsForDates([day1, day2]);

		expect(select).toHaveBeenCalledTimes(2);
		select.mockRestore();
		expect(byDate.get(day1)?.find((s) => s.startTime === '10:00')?.available).toBe(true);
		expect(byDate.get(day2)?.find((s) => s.startTime === '10:00')?.available).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// getConflictDetails — against real rows
// ---------------------------------------------------------------------------

describe('getConflictDetails', () => {
	it('returns empty array when no conflicts exist', async () => {
		booking(makeDate(date, '11:00'), makeDate(date, '12:00'));
		const details = await getConflictDetails(makeDate(date, '10:00'), makeDate(date, '11:00'));
		expect(details).toEqual([]);
	});

	it('returns reservation conflict details', async () => {
		const resStart = makeDate(date, '10:00');
		const resEnd = makeDate(date, '11:00');
		const id = booking(resStart, resEnd);
		booking(resStart, resEnd, { status: 'cancelled' });
		const details = await getConflictDetails(makeDate(date, '10:00'), makeDate(date, '11:00'));
		expect(details).toHaveLength(1);
		expect(details[0]).toEqual({
			type: 'reservation',
			id,
			startsAt: resStart,
			endsAt: resEnd,
			label: 'Alice'
		});
	});

	it('returns closure conflict details', async () => {
		const closureStart = makeDate(date, '14:00');
		const closureEnd = makeDate(date, '16:00');
		closed(closureStart, closureEnd, 'Maintenance');
		const details = await getConflictDetails(makeDate(date, '14:00'), makeDate(date, '16:00'));
		expect(details).toHaveLength(1);
		expect(details[0]).toEqual({
			type: 'closure',
			startsAt: closureStart,
			endsAt: closureEnd,
			label: 'Maintenance'
		});
	});

	it('returns both reservation and closure conflicts', async () => {
		const resStart = makeDate(date, '10:00');
		const resEnd = makeDate(date, '11:00');
		const closureStart = makeDate(date, '10:30');
		const closureEnd = makeDate(date, '11:30');
		sqlite
			.prepare(
				`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
				 values ('res-bob', 'user', 'u-bob', 'u-bob', 'confirmed', ?, ?)`
			)
			.run(secs(resStart), secs(resEnd));
		closed(closureStart, closureEnd, 'Emergency');
		const details = await getConflictDetails(makeDate(date, '10:00'), makeDate(date, '12:00'));
		expect(details.map((d) => [d.type, d.label])).toEqual([
			['reservation', 'Bob'],
			['closure', 'Emergency']
		]);
	});
});

// ---------------------------------------------------------------------------
// getValidationWarnings — now async, reads config from DB
// ---------------------------------------------------------------------------

describe('getValidationWarnings', () => {
	it('returns empty array for valid booking', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '10:00'), makeDate(date, '11:00'));
		expect(warnings).toEqual([]);
	});

	it('returns early if end time is before start time', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '11:00'), makeDate(date, '10:00'));
		expect(warnings).toEqual(['End time must be after start time']);
	});

	it('warns about duration below minimum', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '10:00'), makeDate(date, '10:30'));
		expect(warnings).toContainEqual(expect.stringContaining('1-hour minimum'));
	});

	it('warns about duration above maximum', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '09:00'), makeDate(date, '18:00'));
		expect(warnings).toContainEqual(expect.stringContaining('8-hour maximum'));
	});

	it('warns about non-30-minute boundaries', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '10:15'), makeDate(date, '11:15'));
		expect(warnings).toContainEqual(expect.stringContaining('30-minute boundaries'));
	});

	it('warns about outside operating hours (start too early)', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '08:00'), makeDate(date, '09:00'));
		expect(warnings).toContainEqual(expect.stringContaining('operating hours'));
	});

	it('warns about outside operating hours (end too late)', async () => {
		const warnings = await getValidationWarnings(makeDate(date, '21:00'), makeDate(date, '23:00'));
		expect(warnings).toContainEqual(expect.stringContaining('operating hours'));
	});

	it('warns about too far in advance (one-off)', async () => {
		const farFuture = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
		const dateStr = farFuture.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
		const start = makeDate(dateStr, '10:00');
		const end = makeDate(dateStr, '11:00');
		const warnings = await getValidationWarnings(start, end);
		expect(warnings).toContainEqual(expect.stringContaining('14 days in advance'));
	});

	it('uses recurring window when isRecurring is true', async () => {
		const future = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000);
		const dateStr = future.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
		const start = makeDate(dateStr, '10:00');
		const end = makeDate(dateStr, '11:00');
		const warnings = await getValidationWarnings(start, end, { isRecurring: true });
		// 16 days is within recurring window of 17.5 days
		const advanceWarning = warnings.find((w) => w.includes('days in advance'));
		expect(advanceWarning).toBeUndefined();
	});

	it('warns about recurring too far in advance', async () => {
		const farFuture = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
		const dateStr = farFuture.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
		const start = makeDate(dateStr, '10:00');
		const end = makeDate(dateStr, '11:00');
		const warnings = await getValidationWarnings(start, end, { isRecurring: true });
		expect(warnings).toContainEqual(expect.stringContaining('17.5 days in advance'));
	});

	it('can accumulate multiple warnings', async () => {
		// Too short + not on boundary + outside operating hours
		const warnings = await getValidationWarnings(makeDate(date, '08:15'), makeDate(date, '08:45'));
		expect(warnings.length).toBeGreaterThanOrEqual(2);
	});
});
