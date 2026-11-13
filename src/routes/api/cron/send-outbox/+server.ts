import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { deliverOutbox } from '#lib/server/outbox/outbox-service.js';

/**
 * Cron endpoint for the outbox: sends what is due, which is a message whose
 * first send failed, or one the request that wrote it never got to send.
 * Every 5 minutes (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/send-outbox
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');
	if (request.headers.get('Authorization') !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const deliveries = await deliverOutbox();
	const count = (status: string) => deliveries.filter((d) => d.status === status).length;
	return Response.json({
		sent: count('sent'),
		retrying: count('pending'),
		failed: count('failed')
	});
};
