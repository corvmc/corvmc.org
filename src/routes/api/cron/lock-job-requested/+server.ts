import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { runRequestedLockJob } from '#lib/server/lock/lock-job-request.js';

/**
 * Runs the daily lock job when staff pressed Run now or retried a booking's
 * door codes, every 5 minutes. With no request it reads one KV key and stops.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const result = await runRequestedLockJob();
	if (!result) return Response.json({ ran: false });

	// The Sentry check-in reads response.ok alone.
	return Response.json({ ran: true, ...result }, { status: result.errors.length > 0 ? 500 : 200 });
};
