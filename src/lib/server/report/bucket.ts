import { sql, type SQLWrapper } from 'drizzle-orm';

/**
 * Group a unix-seconds timestamp column into `YYYY-MM` buckets.
 *
 * Buckets in **UTC**, deliberately. The columns this is used on are anchored at
 * noon club time, which lands mid-day UTC at every offset — so the month a row
 * falls into is the same either way, and a timezone conversion here would buy
 * nothing while adding a second place for the offset to be wrong.
 *
 * A column that is *not* noon-anchored (a real event timestamp, say) needs the
 * conversion, and should not use this without adding one.
 */
export function monthBucket(column: SQLWrapper) {
	return sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`;
}

/** The same, at day resolution. Carries the same noon-anchoring caveat. */
export function dayBucket(column: SQLWrapper) {
	return sql<string>`strftime('%Y-%m-%d', ${column}, 'unixepoch')`;
}
