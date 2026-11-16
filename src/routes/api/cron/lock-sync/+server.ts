import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { reconcileUpcomingSync } from '#lib/server/lock/lock-service.js';

/**
 * Confirm which upcoming door codes have reached the lock, every 15 minutes,
 * ahead of the reminder drain that sends `door_code_ready`. The daily
 * `/api/cron/lock-access` run remains the unbounded backstop, and the one that
 * alerts on an offline lock: a skipped pass here reports ok.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const result = await reconcileUpcomingSync();

	// The Sentry check-in reads response.ok alone.
	return Response.json(result, { status: result.errors.length > 0 ? 500 : 200 });
};
