import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sweepAbandonedPurchases } from '$lib/server/audio/purchase-service';

/**
 * Clear music purchases nobody completed.
 *
 * A row is written `pending` before the buyer leaves for Stripe, so an abandoned
 * checkout leaves one behind — the same shape `cancel-stale-tickets` exists for.
 * Nothing here touches R2: an unpaid purchase never owned a file.
 *
 * Invoked by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/sweep-audio-purchases
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	return json({ removed: await sweepAbandonedPurchases() });
};
