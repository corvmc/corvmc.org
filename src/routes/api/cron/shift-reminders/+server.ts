import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { domainEvents } from '$lib/server/events/event-bus';
import { listSignupsStartingBetween } from '$lib/server/volunteer/volunteer-signup-service';

/**
 * Remind confirmed volunteers about tomorrow's shifts.
 *
 * Runs in the daily batch (08:00 PST / 09:00 PDT) — the 09:00 shift reminder the
 * feature catalog has wanted since the Laravel app, finally buildable now there
 * are shifts to remind anyone about.
 *
 * A 24-hour window from the run, so a shift is reminded exactly once: the batch
 * fires daily, and a shift starting inside the next day can only fall in one
 * run's window.
 *
 *   POST /api/cron/shift-reminders
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
	const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

	const due = await listSignupsStartingBetween(now, in24h);

	let emitted = 0;
	for (const row of due) {
		try {
			await domainEvents.emit('volunteer.shift_reminder_due', {
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
			// One bad address must not cost everybody else their reminder.
			console.error(`[cron] shift-reminder failed for ${row.signupId}:`, err);
		}
	}

	return json({ found: due.length, emitted });
};
