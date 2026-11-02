import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { runPartnerImports } from '$lib/server/event/partner-import-service';

/**
 * Copy every unpaused partner feed onto the gig guide (#1459). A feed that
 * fails is recorded on its `calendar_source` row, not as a failed job. Run by
 * the cron handler in src/lib/server/cron/schedule.ts; callable manually with
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	return json({ sources: await runPartnerImports() });
};
