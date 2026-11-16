import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { cancelStalePendingTickets } from '#lib/server/ticket/ticket-service.js';

/**
 * Cron endpoint for cancelling orphaned `pending` tickets. Pending rows are
 * created before the Stripe Checkout redirect and flipped to `valid` by the
 * webhook on payment; a Checkout Session lives at most 24 hours, so anything
 * still pending past that window was abandoned and only clutters the data.
 *
 * Dispatched by the `scheduled` handler's daily batch (see
 * src/lib/server/cron/schedule.ts and [triggers] in wrangler.toml):
 *   POST /api/cron/cancel-stale-tickets
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const cancelled = await cancelStalePendingTickets();

	return Response.json({ cancelled });
};
