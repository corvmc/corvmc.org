import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { completeFinishedShifts } from '$lib/server/volunteer/volunteer-signup-service';

/**
 * Close out shifts that have finished.
 *
 * Runs every 15 minutes beside the reservation auto-complete, for the same
 * reason: a shift that ended at 10pm should read as done well before anybody
 * looks at the page next morning.
 *
 * Only `confirmed` signups complete — see completeFinishedShifts. A claim staff
 * never confirmed is not evidence anyone worked, and completing it would put a
 * pre-filled hour log in front of a member who never got the nod.
 *
 *   POST /api/cron/complete-shifts
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const completed = await completeFinishedShifts();

	let emitted = 0;
	for (const row of completed) {
		try {
			await domainEvents.emit('volunteer.shift_completed', {
				signupId: row.signupId,
				shiftId: row.shiftId,
				userId: row.userId,
				userName: row.userName,
				userEmail: row.userEmail,
				roleName: row.roleName,
				startsAt: row.startsAt.toISOString(),
				endsAt: row.endsAt.toISOString()
			});
			emitted++;
		} catch (err) {
			// The status is already written; a failed notification must not make
			// the next run try to complete the same signup again.
			console.error(`[cron] shift-completed notify failed for ${row.signupId}:`, err);
		}
	}

	return json({ completed: completed.length, emitted });
};
