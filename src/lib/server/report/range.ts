import { and, gte, lte, type SQL, type SQLWrapper } from 'drizzle-orm';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

/**
 * A date range a report was asked for, in **club time**.
 *
 * Both ends are dates rather than timestamps because that is what a staff
 * member types and what a funder asks for. Turning them into instants is this
 * module's job, and it is the part that is easy to get wrong: a naive
 * `new Date('2026-07-01')` is midnight UTC, which is the previous evening here
 * and silently drops or adds a day's work at each end of every report.
 */
export interface ReportRange {
	/** YYYY-MM-DD, inclusive. */
	from?: string;
	/** YYYY-MM-DD, inclusive — the whole day, not its first instant. */
	to?: string;
}

/**
 * A range condition over one timestamp column, anchored in club time.
 *
 * Returns `undefined` for an unbounded range rather than a vacuous `true`, so a
 * caller can spread it into `and(...)` without a special case.
 */
export function rangeCondition(
	column: SQLWrapper,
	range: ReportRange,
	timezone: string = DEFAULT_TIMEZONE
): SQL | undefined {
	const conditions: SQL[] = [];

	if (range.from) conditions.push(gte(column, buildDateInTz(range.from, '00:00', timezone)));
	// 23:59 rather than the next day's 00:00: the columns this filters are
	// minute-resolution, and an exclusive upper bound spelled as a date is the
	// kind of thing that reads correct and quietly excludes the last minute.
	if (range.to) conditions.push(lte(column, buildDateInTz(range.to, '23:59', timezone)));

	return conditions.length > 0 ? and(...conditions) : undefined;
}
