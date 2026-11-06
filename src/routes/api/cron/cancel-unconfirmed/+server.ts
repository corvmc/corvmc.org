import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { cancelUnconfirmedReservations } from '#lib/server/reservation/reservation-service.js';

/**
 * Cron endpoint for releasing reservations never confirmed by their start time.
 * Members must confirm within the confirmation window (or prepay via Stripe);
 * anything still `scheduled` once it starts was never committed, so we cancel it
 * and free the slot (which cascades waitlist promotion).
 *
 * Invoked every 15 minutes by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/cancel-unconfirmed
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const result = await cancelUnconfirmedReservations();

	return Response.json(result);
};
