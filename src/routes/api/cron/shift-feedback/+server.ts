import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { listCompletionsAwaitingFeedback } from '$lib/server/volunteer/volunteer-signup-service';

/**
 * Ask yesterday's volunteers how it went.
 *
 * Runs in the daily batch, after complete-shifts has had a day of 15-minute
 * passes to mark yesterday's signups completed.
 *
 * The window is [48h ago, 24h ago): daily runs tile those windows without
 * overlap, so somebody who never answers is asked exactly once and then left
 * alone — a wider catch-up window would re-ask them every day it still covered
 * the shift. The no-feedback-row filter in the query stays as the backstop for
 * a manually re-fired run.
 *
 *   POST /api/cron/shift-feedback
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const now = new Date();
	const windowEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);

	const due = await listCompletionsAwaitingFeedback(windowStart, windowEnd);

	let emitted = 0;
	for (const row of due) {
		try {
			await domainEvents.emit('volunteer.shift_feedback_due', {
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
			console.error(`[cron] shift-feedback ask failed for ${row.signupId}:`, err);
		}
	}

	return json({ found: due.length, emitted });
};
