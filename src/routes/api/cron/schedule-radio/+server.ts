import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { scheduleRadio } from '$lib/server/audio/radio-service';
import { isFeatureEnabled } from '$lib/server/feature-flags';

/**
 * Keep CMC Radio's timetable ahead of wall clock.
 *
 * On the existing 15-minute trigger, filling to 45 minutes ahead — three passes
 * of slack, so a single missed run is inaudible rather than dead air.
 *
 * Skipped entirely while `cmcRadio` is off, which is the launch switch: there is
 * no point materializing a schedule nothing can tune into, and doing so would
 * spend the rotation's history before anyone hears it, so the first listeners
 * would arrive to a station that had already "recently played" everything.
 *
 * Invoked by the Worker's cron `scheduled` handler
 * (worker.js → src/lib/server/cron/schedule.ts); callable manually:
 *   POST /api/cron/schedule-radio
 *   Authorization: Bearer <CRON_SECRET>
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	if (!(await isFeatureEnabled('cmcRadio'))) {
		return json({ skipped: 'cmcRadio is off', scheduled: 0, pruned: 0 });
	}

	return json(await scheduleRadio());
};
