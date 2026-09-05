// ---------------------------------------------------------------------------
// Timezone utilities — construct and format Dates in a specific IANA timezone.
// ---------------------------------------------------------------------------
// Construction goes through `@internationalized/date` (already a dependency,
// and already what the date pickers in `$lib/components` are built on) rather
// than hand-rolled offset arithmetic.
//
// The reason is the two wall-clock times a named zone cannot answer with a
// single instant. On the spring-forward Sunday, 02:00–02:59 never happens; on
// the fall-back Sunday, 01:00–01:59 happens twice. Offset arithmetic has no way
// to *say* that, so it silently returns whichever instant its correction pass
// converged on — and for the gap it converged BACKWARDS: 02:00 on 2026-03-08
// came back as 01:00, an hour earlier than asked for.
//
// `.toDate(tz)` takes a `disambiguation` instead of guessing. We use its default,
// `compatible` — the rule Temporal and every calendar app follow: a nonexistent
// time shifts forward by the length of the gap, and an ambiguous one takes the
// earlier of its two readings. `timezone.spec.ts` pins both.
//
// Formatting stays on `Intl` — reading an instant back in a zone is unambiguous
// and needs no help.
// ---------------------------------------------------------------------------

import { CalendarDate, CalendarDateTime, fromDate, getDayOfWeek } from '@internationalized/date';

/** Calendar and clock components of an instant, in the given timezone. */
export interface TzParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	/** JS convention: 0 = Sunday. */
	weekday: number;
}

/**
 * Get date/time components for a Date in a specific timezone.
 */
export function getPartsInTz(date: Date, tz: string): TzParts {
	const zoned = fromDate(date, tz);
	return {
		year: zoned.year,
		month: zoned.month,
		day: zoned.day,
		hour: zoned.hour,
		minute: zoned.minute,
		// `en-US` weeks start on Sunday, which is the 0 = Sunday numbering the
		// callers here use.
		weekday: getDayOfWeek(zoned, 'en-US')
	};
}

/**
 * Build a Date from wall-clock components in the given timezone.
 *
 * The counterpart to `getPartsInTz`. `weekday` is ignored — it is derived from
 * the date, so a caller that round-trips parts cannot put the two in conflict.
 */
export function buildDateTimeInTz(
	parts: { year: number; month: number; day: number; hour: number; minute: number },
	tz: string
): Date {
	return new CalendarDateTime(parts.year, parts.month, parts.day, parts.hour, parts.minute).toDate(
		tz
	);
}

/**
 * Build a Date representing `dateStr` at `timeStr` in the given timezone.
 *
 * @param dateStr  "YYYY-MM-DD"
 * @param timeStr  "HH:MM"
 * @param tz       IANA timezone, e.g. "America/Los_Angeles"
 * @returns        A Date whose `.getTime()` is the correct UTC instant
 */
export function buildDateInTz(dateStr: string, timeStr: string, tz: string): Date {
	const [year, month, day] = dateStr.split('-').map(Number);
	const [hour, minute] = timeStr.split(':').map(Number);
	return buildDateTimeInTz({ year, month, day, hour, minute }, tz);
}

/** Add one calendar day to a "YYYY-MM-DD" string. */
export function nextDay(dateStr: string): string {
	const [year, month, day] = dateStr.split('-').map(Number);
	const next = new CalendarDate(year, month, day).add({ days: 1 });
	return `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`;
}

/**
 * Build the start and end instants for a range entered as one date plus a start
 * and an end time.
 *
 * A show that runs past midnight (9 PM – 1 AM) is entered on the day it starts,
 * so its end time reads as *earlier* than its start. Anchoring both to the same
 * date puts the end before the start, which the `ends_at > starts_at` CHECK
 * constraints reject — so an end that falls before the start rolls onto the next
 * calendar day. Equal times are left alone: that's a data-entry mistake, not an
 * overnight range, and callers reject it.
 */
export function buildTimeRangeInTz(
	dateStr: string,
	startTime: string,
	endTime: string,
	tz: string
): { startsAt: Date; endsAt: Date } {
	const startsAt = buildDateInTz(dateStr, startTime, tz);
	const sameDayEnd = buildDateInTz(dateStr, endTime, tz);

	return {
		startsAt,
		endsAt:
			sameDayEnd.getTime() < startsAt.getTime()
				? buildDateInTz(nextDay(dateStr), endTime, tz)
				: sameDayEnd
	};
}

/**
 * Format a Date as "HH:mm" in the given timezone.
 */
export function formatTimeInTz(date: Date, tz: string): string {
	return date.toLocaleString('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
}

/**
 * Format a Date as "YYYY-MM-DD" in the given timezone.
 */
export function formatDateInTz(date: Date, tz: string): string {
	const p = getPartsInTz(date, tz);
	return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Format a Date as a full human-readable date string in the given timezone.
 * e.g. "January 15, 2026"
 */
export function formatDateFull(date: Date, tz: string): string {
	return date.toLocaleString('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

/**
 * Format a Date as a simple time string in the given timezone.
 * e.g. "3:30 PM"
 */
export function formatTimeSimple(date: Date, tz: string): string {
	return date.toLocaleString('en-US', {
		timeZone: tz,
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
}
