import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { group } from '#lib/server/db/schema/group.js';
import { reservation } from '#lib/server/db/schema/reservation.js';

type NewReservation = typeof reservation.$inferInsert;

/**
 * The one way a reservation row is written. A club or committee holds the room
 * free (decision 0024), so its booking is written settled, `cashDueCents = 0`;
 * a null there reads as owed in full. `scripts/reservation-insert.spec.ts`
 * keeps every other insert out.
 */
export async function insertReservation(values: NewReservation) {
	const free = values.bookerType === 'group' && (await isProgram(values.bookerId));
	const [row] = await db
		.insert(reservation)
		.values(free ? { ...values, cashDueCents: 0 } : values)
		.returning();
	return row;
}

async function isProgram(groupId: string): Promise<boolean> {
	const [row] = await db
		.select({ kind: group.kind })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	return !!row && row.kind !== 'band';
}
