import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { processDueCampaigns } from '$lib/server/marketing/campaign-service';

/**
 * Cron endpoint for sending scheduled campaigns.
 * Picks up campaigns where scheduledFor <= now() and sentAt is null,
 * then executes the send for each.
 *
 * Schedule: every minute (or every 5 minutes)
 *   POST /api/cron/send-campaigns
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const processed = await processDueCampaigns();
	return json({ processed });
};
