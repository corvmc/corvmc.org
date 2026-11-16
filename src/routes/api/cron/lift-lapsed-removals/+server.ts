import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { liftLapsedSuspensions } from '#lib/server/user/user-service.js';

/**
 * Lift every suspension whose term has ended (#2552). Idempotent. Run by the
 * cron handler in src/lib/server/cron/schedule.ts; callable manually with
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	return Response.json(await liftLapsedSuspensions());
};
