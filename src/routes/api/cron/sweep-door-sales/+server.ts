import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { sweepDoorSales } from '#lib/server/ticket/door-sale.js';

/**
 * Checks in door card sales whose `payment_intent.succeeded` webhook never
 * arrived, and reports charged intents with no tickets left (#2547).
 *
 * Dispatched by the `scheduled` handler's 15-minute batch:
 *   POST /api/cron/sweep-door-sales  ·  Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	return Response.json(await sweepDoorSales());
};
