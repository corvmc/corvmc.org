import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { volunteerSignup, workOrder } from '$lib/server/db/schema/volunteer';
import { requireUser } from '$lib/server/authorization';
import type { VolunteerSignupStatus } from '$lib/config';

/** Signups that mean the member is working the show, or did. */
const HELD: VolunteerSignupStatus[] = ['claimed', 'confirmed', 'completed'];

/** Does this member hold a live volunteer shift on this event? */
export async function isShowCrew(userId: string, eventId: string): Promise<boolean> {
	const rows = await db
		.select({ id: volunteerSignup.id })
		.from(volunteerSignup)
		.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
		.where(
			and(
				eq(volunteerSignup.userId, userId),
				eq(workOrder.eventId, eventId),
				inArray(volunteerSignup.status, HELD),
				isNull(workOrder.cancelledAt)
			)
		)
		.limit(1);
	return rows.length > 0;
}

/** Assert the caller is on the crew of this show. Returns the user. */
export async function requireShowCrew(eventId: string) {
	const user = requireUser();
	if (!(await isShowCrew(user.id, eventId)))
		throw error(403, 'You are not on the crew of this show');
	return user;
}
