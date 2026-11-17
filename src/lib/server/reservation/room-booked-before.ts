import { and, gt, lt, notInArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { EARLY_OPEN_MINUTES, bookedUntilBefore } from '#lib/utils/door-code-window.js';

/**
 * For each reservation, when the room is booked until ahead of it, where that
 * booking runs into its early-open minutes. Read when the code is shown, not
 * stored, so a booking made later still counts. One query for the whole set.
 */
export async function roomBookedBefore(
	rows: readonly { id: string; startsAt: Date }[]
): Promise<Map<string, Date>> {
	const out = new Map<string, Date>();
	if (rows.length === 0) return out;
	const starts = rows.map((r) => r.startsAt.getTime());
	const from = new Date(Math.min(...starts) - EARLY_OPEN_MINUTES * 60_000);
	const to = new Date(Math.max(...starts));

	const others = await db
		.select({ id: reservation.id, startsAt: reservation.startsAt, endsAt: reservation.endsAt })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, to),
				gt(reservation.endsAt, from)
			)
		);

	for (const r of rows) {
		const until = bookedUntilBefore(r, others);
		if (until) out.set(r.id, until);
	}
	return out;
}
