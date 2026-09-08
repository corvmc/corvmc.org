import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runDailyLockJob } from '$lib/server/lock/lock-service';

/**
 * Cron endpoint for daily lock access provisioning and cleanup.
 * Protected by a shared secret in the Authorization header.
 *
 * Invoked daily (16:00 UTC batch) by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/lock-access
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const result = await runDailyLockJob();

	const body = {
		provisioned: result.provisioned,
		cleaned: result.cleaned,
		confirmed: result.confirmed,
		online: result.online,
		errors: result.errors
	};

	// `runScheduledJobs` derives its Sentry Crons check-in from response.ok
	// alone, so returning 200 with a populated `errors` array closed the check-in
	// green through a total lock outage. Anything that went wrong is a failed
	// run — including the lock being unreachable, which is exactly the state
	// nobody was finding out about.
	if (result.errors.length > 0) {
		return json(body, { status: 500 });
	}

	return json(body);
};
