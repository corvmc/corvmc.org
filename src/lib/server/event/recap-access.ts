import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { volunteerSignup, workOrder } from '$lib/server/db/schema/volunteer';
import { can } from '$lib/server/authorization';
import { SHOW_DOCUMENTATION_ROLE_ID } from '$lib/config';

/** Staff said yes: confirmed ahead of the show, completed once it is closed out. */
const ASSIGNED = ['confirmed', 'completed'] as const;

/** Is this member staff-confirmed on this event's show-documentation work order? */
async function documentsShow(userId: string, eventId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: volunteerSignup.id })
		.from(volunteerSignup)
		.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
		.where(
			and(
				eq(volunteerSignup.userId, userId),
				inArray(volunteerSignup.status, [...ASSIGNED]),
				eq(workOrder.eventId, eventId),
				eq(workOrder.volunteerRoleId, SHOW_DOCUMENTATION_ROLE_ID),
				isNull(workOrder.cancelledAt)
			)
		)
		.limit(1);
	return !!row;
}

/**
 * Why the caller may upload recap photos to this event: `event.uploadRecap`
 * from the position matrix, being this show's documentation volunteer (#1500),
 * or not at all. The second never reaches another event.
 */
export async function recapUploadAccess(
	userId: string | undefined,
	eventId: string
): Promise<'capability' | 'photographer' | null> {
	if (!userId) return null;
	if (await can('event.uploadRecap')) return 'capability';
	if (await documentsShow(userId, eventId)) return 'photographer';
	return null;
}
