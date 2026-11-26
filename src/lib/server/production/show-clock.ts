import { buildDateInTz, formatDateInTz, nextDay } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';

/** Before this hour a run-of-show time is after midnight, on the next day. */
const NIGHT_ENDS_HOUR = 6;

/**
 * The instant a run-of-show time names, on the night of a show (#3272).
 *
 * The run of show takes a time, not a date: every row is on the show's date,
 * except a time before 06:00, which is the early hours after it — a 00:30
 * curfew is after the last set, not eighteen hours before the first.
 */
export function showClockTime(showStartsAt: Date, time: string, tz = DEFAULT_TIMEZONE): Date {
	const date = formatDateInTz(showStartsAt, tz);
	const hour = Number(time.split(':')[0]);
	return buildDateInTz(hour < NIGHT_ENDS_HOUR ? nextDay(date) : date, time, tz);
}
