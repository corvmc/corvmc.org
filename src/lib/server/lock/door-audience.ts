import { db } from '#lib/server/db/index.js';
import { groupMember } from '#lib/server/db/schema/group.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { and, eq } from 'drizzle-orm';

// Who a band booking's door belongs to (#2120): the booker, and every active
// member of the band it was booked for, the same rule as paying for it
// (#2095). A pending invite is not a member yet.
const activeMember = () => eq(groupMember.status, 'active');

/** Bands the member belongs to, as the booker id a group booking carries. */
export async function bandIdsFor(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: groupMember.groupId })
		.from(groupMember)
		.where(and(eq(groupMember.userId, userId), activeMember()));
	return rows.map((r) => r.id);
}

/** The active members of the band a booking was made for; none for a member's own booking. */
export async function bandmatesOn(reservationId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: groupMember.userId })
		.from(reservation)
		.innerJoin(
			groupMember,
			and(
				eq(reservation.bookerType, 'group'),
				eq(groupMember.groupId, reservation.bookerId),
				activeMember()
			)
		)
		.where(eq(reservation.id, reservationId));
	return rows.map((r) => r.userId);
}
