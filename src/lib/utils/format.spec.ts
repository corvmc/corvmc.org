// Force a non-venue ambient timezone BEFORE importing the module under test.
// The venue is America/Los_Angeles, and a developer machine set to that zone
// would let every assertion below pass for the wrong reason — local and venue
// rendering would be identical. UTC makes the two disagree, which is the whole
// point of these tests.
process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE } from '$lib/config';
import {
	formatDate,
	formatDateLong,
	formatDateShort,
	formatDateShortYear,
	formatDateTime,
	formatDateTimeShort,
	formatDateYear,
	formatDayNumber,
	formatDayOfWeek,
	formatShortMonth,
	formatWeekdayShortCased,
	formatMonthShortCased,
	formatDuration,
	isVenueToday,
	isVenueTomorrow,
	isVenueThisWeek,
	formatTime,
	formatTimeRange,
	fullDate,
	initials,
	formatPaymentBreakdown,
	reservationPaymentBreakdown,
	toLocalDate,
	toLocalTime,
	formatBytes
} from './format';

/**
 * 2026-07-04T02:30:00Z is 2026-07-03 19:30 PDT.
 *
 * Deliberately chosen so the venue and UTC disagree about the *day*, not just
 * the clock time — a bug that only shifts hours is easy to miss, one that
 * shifts the date shows up in every grouped list.
 */
const CROSSES_MIDNIGHT = new Date('2026-07-04T02:30:00Z');

/** 2026-01-15T21:00:00Z is 2026-01-15 13:00 PST — same day, standard time. */
const SAME_DAY_WINTER = new Date('2026-01-15T21:00:00Z');

describe('format.ts renders in venue time, not the viewer’s zone', () => {
	it('runs under an ambient zone that differs from the venue', () => {
		// Guards the guard: if this ever fails, every other assertion in this
		// file is meaningless because local and venue rendering coincide.
		expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe(DEFAULT_TIMEZONE);
	});

	describe('when the venue date and the UTC date differ', () => {
		it('formatDate uses the venue day', () => {
			expect(formatDate(CROSSES_MIDNIGHT)).toBe('Fri, Jul 3');
		});

		it('formatDateYear uses the venue day', () => {
			expect(formatDateYear(CROSSES_MIDNIGHT)).toBe('Fri, Jul 3, 2026');
		});

		it('formatDateLong uses the venue day and omits the year', () => {
			expect(formatDateLong(CROSSES_MIDNIGHT)).toBe('Friday, July 3');
		});

		it('fullDate uses the venue day', () => {
			expect(fullDate(CROSSES_MIDNIGHT)).toBe('Friday, July 3, 2026');
		});

		it('formatDateShort uses the venue day', () => {
			expect(formatDateShort(CROSSES_MIDNIGHT)).toBe('Jul 3');
		});

		it('formatDateShortYear uses the venue day', () => {
			expect(formatDateShortYear(CROSSES_MIDNIGHT)).toBe('Jul 3, 2026');
		});

		it('formatDayOfWeek uses the venue weekday', () => {
			expect(formatDayOfWeek(CROSSES_MIDNIGHT)).toBe('FRI');
		});

		it('formatDayNumber uses the venue day of month', () => {
			expect(formatDayNumber(CROSSES_MIDNIGHT)).toBe('3');
		});

		it('formatShortMonth uses the venue month', () => {
			expect(formatShortMonth(CROSSES_MIDNIGHT)).toBe('JUL');
		});

		it('formatWeekdayShortCased uses the venue weekday, without shouting', () => {
			expect(formatWeekdayShortCased(CROSSES_MIDNIGHT)).toBe('Fri');
		});

		it('formatMonthShortCased uses the venue month, without shouting', () => {
			expect(formatMonthShortCased(CROSSES_MIDNIGHT)).toBe('Jul');
		});

		it('formatTime uses the venue clock', () => {
			expect(formatTime(CROSSES_MIDNIGHT)).toBe('7:30 PM');
		});

		it('formatDateTime uses the venue day and clock', () => {
			expect(formatDateTime(CROSSES_MIDNIGHT)).toBe('Fri, Jul 3, 7:30 PM');
		});

		it('formatDateTimeShort uses the venue day and clock', () => {
			expect(formatDateTimeShort(CROSSES_MIDNIGHT)).toBe('Jul 3, 7:30 PM');
		});

		it('toLocalDate emits the venue date for date inputs', () => {
			expect(toLocalDate(CROSSES_MIDNIGHT)).toBe('2026-07-03');
		});

		it('toLocalTime emits the venue time for time inputs', () => {
			expect(toLocalTime(CROSSES_MIDNIGHT)).toBe('19:30');
		});
	});

	describe('standard time (no DST offset)', () => {
		it('formatTime applies the winter offset', () => {
			expect(formatTime(SAME_DAY_WINTER)).toBe('1:00 PM');
		});

		it('formatDate is unchanged when both zones agree on the day', () => {
			expect(formatDate(SAME_DAY_WINTER)).toBe('Thu, Jan 15');
		});
	});

	describe('formatTimeRange', () => {
		it('renders both ends in venue time', () => {
			const end = new Date('2026-07-04T05:00:00Z'); // 22:00 PDT, same venue day
			expect(formatTimeRange(CROSSES_MIDNIGHT, end)).toBe('7:30 PM – 10:00 PM');
		});
	});

	/**
	 * The reservation card asked date-fns these three, which compare the
	 * *viewer's* calendar days. `CROSSES_MIDNIGHT` is 19:30 on the 3rd at the
	 * venue and 02:30 on the 4th in UTC, so a booking that is "today" at the door
	 * reads as "tomorrow" to anyone east of the venue — the exact hour the member
	 * turns up.
	 */
	describe('venue-time day predicates', () => {
		it('calls the venue evening today, where the viewer has already rolled over', () => {
			expect(isVenueToday(CROSSES_MIDNIGHT, CROSSES_MIDNIGHT)).toBe(true);
			expect(isVenueTomorrow(CROSSES_MIDNIGHT, CROSSES_MIDNIGHT)).toBe(false);
		});

		it('counts tomorrow from the venue calendar day', () => {
			const nextEvening = new Date('2026-07-05T02:30:00Z'); // Jul 4, 19:30 PDT
			expect(isVenueTomorrow(nextEvening, CROSSES_MIDNIGHT)).toBe(true);
			expect(isVenueToday(nextEvening, CROSSES_MIDNIGHT)).toBe(false);
		});

		it('keeps date-fns week semantics — the calendar week, not the next seven days', () => {
			// Jul 3 2026 is a Friday, so Sunday Jul 5 opens a new week even though
			// it is two days out.
			const sunday = new Date('2026-07-06T02:30:00Z'); // Jul 5, 19:30 PDT
			expect(isVenueThisWeek(sunday, CROSSES_MIDNIGHT)).toBe(false);

			const saturday = new Date('2026-07-05T02:30:00Z'); // Jul 4, 19:30 PDT
			expect(isVenueThisWeek(saturday, CROSSES_MIDNIGHT)).toBe(true);
		});
	});

	describe('formatDuration', () => {
		it('drops the plural for exactly one hour', () => {
			const end = new Date(CROSSES_MIDNIGHT.getTime() + 60 * 60 * 1000);
			expect(formatDuration(CROSSES_MIDNIGHT, end)).toBe('1 hour');
		});

		it('keeps a half hour as a half hour', () => {
			const end = new Date(CROSSES_MIDNIGHT.getTime() + 150 * 60 * 1000);
			expect(formatDuration(CROSSES_MIDNIGHT, end)).toBe('2.5 hours');
		});

		it('rounds a duration no booking form could have produced', () => {
			const end = new Date(CROSSES_MIDNIGHT.getTime() + 80 * 60 * 1000);
			expect(formatDuration(CROSSES_MIDNIGHT, end)).toBe('1.3 hours');
		});
	});
});

describe('initials', () => {
	it('takes the first letter of the first two words', () => {
		expect(initials('Jordan Martinez')).toBe('JM');
	});

	it('caps at two even for longer names', () => {
		expect(initials('Mary Anne Von Trapp')).toBe('MA');
	});

	it('handles a single word', () => {
		expect(initials('Prince')).toBe('P');
	});

	// The two copies this replaced used a bare split(' '), so a trailing or
	// doubled space produced an undefined segment and rendered "UNDEFINED".
	it('ignores empty segments from stray whitespace', () => {
		expect(initials('Jordan  Martinez ')).toBe('JM');
	});

	it('upper-cases a lowercase name', () => {
		expect(initials('ada lovelace')).toBe('AL');
	});
});

/**
 * The venue rate at the time these were written. A credit is worth an hour of
 * room time, so at $15.00/hr one credit displaces exactly 1500 cents.
 */
const RATE = 1500;

/** A booking of `hours` length, anchored anywhere — only the span matters here. */
function booking(hours: number): [Date, Date] {
	const startsAt = new Date('2026-07-03T18:00:00Z');
	return [startsAt, new Date(startsAt.getTime() + hours * 60 * 60 * 1000)];
}

describe('formatPaymentBreakdown', () => {
	it('shows dollars alone when no credits were applied', () => {
		expect(formatPaymentBreakdown(...booking(2.5), RATE, null)).toBe('$37.50');
	});

	it('treats zero credits the same as none', () => {
		expect(formatPaymentBreakdown(...booking(2), RATE, 0)).toBe('$30.00');
	});

	it('shows both halves when a booking is partly covered', () => {
		expect(formatPaymentBreakdown(...booking(2.5), RATE, 1.5)).toBe('$15.00, 1.5cr');
	});

	// The whole point of the change: a fully covered booking used to render its
	// full list price, which read as though the member still owed it.
	it('drops the dollar half when credits cover the whole booking', () => {
		expect(formatPaymentBreakdown(...booking(2.5), RATE, 2.5)).toBe('2.5cr');
	});

	it('trims a whole credit count rather than showing 2.0cr', () => {
		expect(formatPaymentBreakdown(...booking(2), RATE, 2)).toBe('2cr');
	});

	// Half credits are normal — the venue books in 30-minute blocks.
	it('renders a half credit', () => {
		expect(formatPaymentBreakdown(...booking(1), RATE, 0.5)).toBe('$7.50, 0.5cr');
	});
});

describe('reservationPaymentBreakdown', () => {
	it('splits the list price into cash and credits', () => {
		expect(reservationPaymentBreakdown(...booking(2.5), RATE, 1.5)).toEqual({
			cashCents: 1500,
			credits: 1.5
		});
	});

	// Credits are reversed on cancel and re-committed on confirm, so a row can
	// carry more credit-hours than it books. That must not bill a negative.
	it('never returns negative cash when credits exceed the booking', () => {
		expect(reservationPaymentBreakdown(...booking(1), RATE, 4)).toEqual({
			cashCents: 0,
			credits: 4
		});
	});

	it('ignores a negative credit value', () => {
		expect(reservationPaymentBreakdown(...booking(1), RATE, -2)).toEqual({
			cashCents: 1500,
			credits: 0
		});
	});
});

describe('formatBytes', () => {
	it('keeps small files in bytes, which is what a chart or an agenda is', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(170)).toBe('170 B');
		expect(formatBytes(1023)).toBe('1023 B');
	});

	it('rounds kilobytes, where a decimal buys nothing', () => {
		expect(formatBytes(1024)).toBe('1 KB');
		expect(formatBytes(1536)).toBe('2 KB');
	});

	it('keeps one decimal below 10MB and drops it above, so a column lines up', () => {
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
		expect(formatBytes(9.5 * 1024 * 1024)).toBe('9.5 MB');
		expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
		expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
	});
});
