import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { sweepExpiredContacts } from '#lib/server/directory/contact-service.js';

/**
 * Delete contacts whose `retain_until` has passed (#2622), with their roles.
 * Run by the cron handler in src/lib/server/cron/schedule.ts; callable
 * manually with `Authorization: Bearer <CRON_SECRET>`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	return Response.json(await sweepExpiredContacts());
};
