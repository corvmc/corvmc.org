import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sweepExpiredIncidents } from '$lib/server/incident/incident-retention';

/**
 * Delete incidents more than seven years old that staff have not marked
 * `retain`, writing each deletion to the audit log (#1468). Run by the cron
 * handler in src/lib/server/cron/schedule.ts; callable manually with
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	return json(await sweepExpiredIncidents());
};
