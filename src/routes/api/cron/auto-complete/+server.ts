import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { autoCompleteExpired } from '#lib/server/reservation/reservation-service.js';

/**
 * Cron endpoint for auto-completing paid reservations past their end time.
 * Protected by a shared secret in the Authorization header.
 *
 * Invoked every 15 minutes by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/auto-complete
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const completed = await autoCompleteExpired();

	return Response.json({ completed });
};
