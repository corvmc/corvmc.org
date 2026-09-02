import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { wakeSnoozedThreads, nudgeStaleAwaiting } from '$lib/server/inbox/thread-service';

/**
 * Cron endpoint for returning inbox threads to the open queue once whatever took
 * them out of it has elapsed. Two of those, and they are the same job:
 *
 *  - a snooze whose date has passed. Without this a snooze is indistinguishable
 *    from deleting the thread — the default view only shows open conversations.
 *  - an awaiting-reply marker older than a week. "Send + wait for reply" is the
 *    default send, and it is only safe because of this: a contact who never
 *    writes back would otherwise take the conversation out of the queue for
 *    good.
 *
 * Invoked every 15 minutes by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/wake-snoozed
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	// Sequential, not Promise.all: both write `inbox_thread`, and D1 has no
	// transaction to arbitrate two overlapping updates to the same rows.
	const woken = await wakeSnoozedThreads();
	const nudged = await nudgeStaleAwaiting();

	return json({ ...woken, ...nudged });
};
