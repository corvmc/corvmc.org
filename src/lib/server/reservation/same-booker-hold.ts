import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import type { BookerType } from '#lib/config.js';

export interface SameBookerSlot {
	bookerType: BookerType;
	bookerId: string;
	startsAt: Date;
	endsAt: Date;
	/** A series' own rows are its occurrences, not a second booking of the slot. */
	excludeSeriesId?: string;
}

/**
 * Whether this booker already holds a live row overlapping the slot. A booker
 * cannot wait behind themselves: such a slot is a duplicate, so every path that
 * writes a waitlisted row asks this first (#3031). A waitlisted row counts too,
 * since a second queue place for the same time is also a duplicate.
 * `scripts/waitlist-same-booker.spec.ts` keeps every waitlisted write behind it.
 */
export async function heldBySameBooker(slot: SameBookerSlot): Promise<boolean> {
	const rows = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				eq(reservation.bookerType, slot.bookerType),
				eq(reservation.bookerId, slot.bookerId),
				ne(reservation.status, 'cancelled'),
				lt(reservation.startsAt, slot.endsAt),
				gt(reservation.endsAt, slot.startsAt),
				slot.excludeSeriesId
					? or(
							isNull(reservation.recurringSeriesId),
							ne(reservation.recurringSeriesId, slot.excludeSeriesId)
						)
					: undefined
			)
		)
		.limit(1);
	return rows.length > 0;
}
