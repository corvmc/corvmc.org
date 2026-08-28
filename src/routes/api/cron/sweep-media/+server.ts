import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sweepMedia } from '$lib/server/media/media-sweep-service';

/**
 * Cron endpoint for reclaiming R2 objects nothing points at any more.
 *
 * This is the other half of the rule in docs/specs/media-spec.md: the write path
 * never deletes an object, because no single write can see whether a sibling
 * still needs it. Without this job that rule would just be a leak.
 *
 * Invoked daily by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/sweep-media
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	const result = await sweepMedia();

	return json(result);
};
