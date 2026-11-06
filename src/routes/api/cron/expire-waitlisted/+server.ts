import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { expireWaitlisted } from '#lib/server/reservation/waitlist-service.js';

/**
 * Cron endpoint for expiring waitlisted reservations past their 24h window.
 * Runs every 15 minutes. Cancelled waitlisted reservations cascade promotion
 * to the next person in line.
 *
 * Invoked by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/expire-waitlisted
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const result = await expireWaitlisted();

	return Response.json(result);
};
