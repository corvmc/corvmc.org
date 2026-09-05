import { addWeeks } from 'date-fns';
import { CalendarDate, endOfMonth } from '@internationalized/date';
import type { RecurringFrequency } from '$lib/server/db/schema/recurring';
import type { BookerType } from '$lib/config';
import { getReservationConfig, termsFor } from './config';
import { buildDateTimeInTz, getPartsInTz } from './timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Recurrence helpers — build, parse, and generate occurrence dates
// ---------------------------------------------------------------------------
// Replaces the `rrule` library with simple date arithmetic for the three
// recurrence patterns we support: weekly, biweekly, monthly (nth weekday).
//
// Stored format: a compact JSON string (not RFC 5545 RRULE) containing
// the frequency, interval, timezone, start components, and weekday info.
// ---------------------------------------------------------------------------

const TZ = DEFAULT_TIMEZONE;

/** How a monthly rule repeats. */
export type MonthlyMode = 'weekday' | 'monthday';

/** Serialized recurrence rule */
interface RecurrenceRule {
	freq: 'weekly' | 'monthly';
	interval: number;
	tz: string;
	/** Start time components in the target timezone */
	start: { year: number; month: number; day: number; hour: number; minute: number };
	/** JS weekday 0=Sun..6=Sat */
	weekday: number;
	/** For monthly: whether it repeats on the nth weekday or a fixed day of the month */
	monthlyMode?: MonthlyMode;
	/** For monthly weekday mode: which occurrence of the weekday (1st, 2nd, 3rd, etc.) */
	nthWeek?: number;
	/** For monthly monthday mode: the fixed day of the month (1-31) */
	dayOfMonth?: number;
}

/**
 * Build a recurrence rule string from a prototype date and frequency.
 *
 * For weekly/biweekly: recurs on the same day of the week.
 * For monthly: recurs either on the nth weekday of the month (e.g., "3rd Tuesday",
 * the default) or on a fixed day of the month (e.g., "the 20th") when
 * `monthlyMode` is `'monthday'`.
 */
export function buildRRule(
	prototypeStartsAt: Date,
	frequency: RecurringFrequency,
	monthlyMode: MonthlyMode = 'weekday'
): string {
	const parts = getPartsInTz(prototypeStartsAt, TZ);
	const isMonthly = frequency === 'monthly';

	const rule: RecurrenceRule = {
		freq: isMonthly ? 'monthly' : 'weekly',
		interval: frequency === 'biweekly' ? 2 : 1,
		tz: TZ,
		start: {
			year: parts.year,
			month: parts.month,
			day: parts.day,
			hour: parts.hour,
			minute: parts.minute
		},
		weekday: parts.weekday,
		monthlyMode: isMonthly ? monthlyMode : undefined,
		nthWeek: isMonthly && monthlyMode === 'weekday' ? Math.ceil(parts.day / 7) : undefined,
		dayOfMonth: isMonthly && monthlyMode === 'monthday' ? parts.day : undefined
	};

	return JSON.stringify(rule);
}

/**
 * Parse a stored recurrence rule string.
 */
export function parseRRule(rruleString: string): RecurrenceRule {
	return JSON.parse(rruleString) as RecurrenceRule;
}

/**
 * Generate occurrence dates within a window.
 *
 * Returns Date objects for each occurrence start time.
 * The caller computes endsAt by adding the prototype's duration.
 *
 * @param rruleString  Stored recurrence rule string
 * @param after        Window start (exclusive)
 * @param before       Window end (exclusive)
 * @returns            Array of occurrence start times
 */
export function getOccurrences(rruleString: string, after: Date, before: Date): Date[] {
	const rule = parseRRule(rruleString);
	const occurrences: Date[] = [];

	if (rule.freq === 'weekly') {
		// Start from the rule's initial date and step forward
		let current = buildDateTimeInTz(rule.start, rule.tz);

		// If starting before the window, advance to the first candidate in/near the window
		while (current.getTime() <= after.getTime()) {
			current = addWeeks(current, rule.interval);
		}

		// Generate occurrences within the window
		while (current.getTime() < before.getTime()) {
			if (current.getTime() > after.getTime()) {
				occurrences.push(current);
			}
			current = addWeeks(current, rule.interval);
		}
	} else if (rule.freq === 'monthly') {
		// Monthly: find the matching date in each month - either the nth weekday
		// (e.g. "2nd Tuesday") or a fixed day of the month (e.g. "the 20th").
		let current = buildDateTimeInTz(rule.start, rule.tz);
		let year = rule.start.year;
		let month = rule.start.month;

		// Advance month-by-month until we're past the window start
		while (current.getTime() <= after.getTime()) {
			month += rule.interval;
			if (month > 12) {
				year += Math.floor((month - 1) / 12);
				month = ((month - 1) % 12) + 1;
			}
			const candidate = findMonthlyOccurrence(rule, year, month);
			if (candidate) current = candidate;
		}

		// Generate occurrences within the window
		while (current.getTime() < before.getTime()) {
			if (current.getTime() > after.getTime()) {
				occurrences.push(current);
			}
			month += rule.interval;
			if (month > 12) {
				year += Math.floor((month - 1) / 12);
				month = ((month - 1) % 12) + 1;
			}
			const candidate = findMonthlyOccurrence(rule, year, month);
			if (candidate) {
				current = candidate;
			} else {
				break; // the target date doesn't exist this month (e.g. 5th Tuesday, or the 31st)
			}
		}
	}

	return occurrences;
}

/**
 * Compute the generation window end from a reference time.
 *
 * Per booker type, not global. A teaching series is materialised further ahead
 * than a member one, and that is not a courtesy — it is what stops a teacher
 * losing the slot they teach in every week.
 *
 * `checkEventAndClosureConflict` treats only `bookerType: 'event_listing'` as a hard
 * block, so a teaching series is Tier 2 and *can* be waitlisted behind a
 * member's one-off booking. The mitigation needs no new machinery: a teaching
 * horizon longer than any member can book into means the series already exists
 * before a member can reach that week. `updateReservationSettings` refuses to
 * save config that breaks the inequality.
 *
 * Defaults to `'user'` so a caller that has no booker in hand keeps the member
 * window it had before this parameter existed.
 */
export async function generationWindowEnd(
	from: Date = new Date(),
	bookerType: BookerType = 'user'
): Promise<Date> {
	const config = await getReservationConfig();
	const { maxAdvanceDaysRecurring } = termsFor(bookerType, config);
	return new Date(from.getTime() + maxAdvanceDaysRecurring * 24 * 60 * 60 * 1000);
}

/**
 * Extract a human-readable frequency label from a recurrence rule string.
 */
export function describeFrequency(rruleString: string): string {
	const rule = parseRRule(rruleString);

	if (rule.freq === 'monthly') return 'Monthly';
	if (rule.freq === 'weekly' && rule.interval === 2) return 'Every 2 weeks';
	if (rule.freq === 'weekly') return 'Weekly';

	return `Every ${rule.interval} weeks`;
}

/**
 * Extract the monthly repeat mode from a stored rule, or null for non-monthly rules.
 */
export function monthlyModeOf(rruleString: string): MonthlyMode | null {
	const rule = parseRRule(rruleString);
	if (rule.freq !== 'monthly') return null;
	return rule.monthlyMode ?? 'weekday';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Last day of a 1-based month, without routing through a local-time `Date`. */
function daysInMonth(year: number, month: number): number {
	return endOfMonth(new CalendarDate(year, month, 1)).day;
}

/**
 * Resolve a monthly rule's occurrence in a specific month, honoring its mode.
 * Returns null when the target date doesn't exist that month.
 */
function findMonthlyOccurrence(rule: RecurrenceRule, year: number, month: number): Date | null {
	const { hour, minute } = rule.start;
	if (rule.monthlyMode === 'monthday') {
		return findDayOfMonth(year, month, rule.dayOfMonth ?? rule.start.day, hour, minute, rule.tz);
	}
	return findNthWeekdayOfMonth(year, month, rule.weekday, rule.nthWeek ?? 1, hour, minute, rule.tz);
}

/**
 * Resolve a fixed day of the month (e.g. the 20th).
 * Returns null if the day doesn't exist in the month (e.g. the 31st of February).
 */
function findDayOfMonth(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	tz: string
): Date | null {
	if (day > daysInMonth(year, month)) return null;
	return buildDateTimeInTz({ year, month, day, hour, minute }, tz);
}

/**
 * Find the nth occurrence of a weekday in a given month.
 * Returns null if the nth occurrence doesn't exist (e.g., 5th Tuesday in a short month).
 */
function findNthWeekdayOfMonth(
	year: number,
	month: number,
	weekday: number,
	nth: number,
	hour: number,
	minute: number,
	tz: string
): Date | null {
	// Start at the 1st of the month
	const firstOfMonth = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
	const firstParts = getPartsInTz(firstOfMonth, tz);

	// Find the first occurrence of the target weekday
	let dayOfMonth = 1 + ((weekday - firstParts.weekday + 7) % 7);

	// Advance to the nth occurrence
	dayOfMonth += (nth - 1) * 7;

	// Check if this day exists in the month
	if (dayOfMonth > daysInMonth(year, month)) return null;

	return buildDateTimeInTz({ year, month, day: dayOfMonth, hour, minute }, tz);
}
