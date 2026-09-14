import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { and, count, eq, notInArray, sql } from 'drizzle-orm';
import { rangeCondition, type ReportRange } from '$lib/server/report/range';

/**
 * How much the practice room was used over a window.
 *
 * Hours come from `startsAt`/`endsAt`, not from what was billed: a comped or
 * credit-covered hour is the room being used but adds nothing to the revenue
 * line. The two numbers are not expected to agree.
 */

export interface RoomUseTotals {
	/** Bookings that stood — anything not cancelled or waitlisted. */
	sessions: number;
	hours: number;
	distinctBookers: number;
	/** Booked, held the room, and nobody came. Included in the two above. */
	noShows: number;
}

// Seconds, divided once in TypeScript. `integer({ mode: 'timestamp' })` stores
// seconds, and dividing per row inside the sum would truncate each booking
// before adding it.
const sumSeconds = sql<number>`coalesce(sum(${reservation.endsAt} - ${reservation.startsAt}), 0)`;

const heldIn = (range: ReportRange) =>
	and(
		notInArray(reservation.status, ['cancelled', 'waitlisted']),
		rangeCondition(reservation.startsAt, range)
	);

export async function getRoomUseTotals(range: ReportRange = {}): Promise<RoomUseTotals> {
	const [row] = await db
		.select({
			sessions: count(),
			seconds: sumSeconds,
			// A booker is a member or a band, so the pair is the identity — two
			// bands sharing an id space with members would otherwise collapse.
			distinctBookers: sql<number>`count(distinct ${reservation.bookerType} || ':' || ${reservation.bookerId})`
		})
		.from(reservation)
		.where(heldIn(range));

	const [noShowRow] = await db
		.select({ total: count() })
		.from(reservation)
		.where(and(eq(reservation.status, 'no_show'), rangeCondition(reservation.startsAt, range)));

	return {
		sessions: Number(row?.sessions ?? 0),
		hours: Math.round(Number(row?.seconds ?? 0) / 3600),
		distinctBookers: Number(row?.distinctBookers ?? 0),
		noShows: noShowRow?.total ?? 0
	};
}
