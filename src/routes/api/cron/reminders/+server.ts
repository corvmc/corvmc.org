import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { drainReminders } from '$lib/server/reminders/drain';

/**
 * Send whatever reminders are owed. One job for the whole registry.
 *
 * Every 15 minutes, which the sent-mark makes safe: what fires once is decided
 * by `reminder_sent`, not by the cadence. It replaced four daily endpoints that
 * each argued from their own schedule, and #1123 was one of those arguments
 * being wrong. Definitions: `src/lib/server/reminders/registry.ts`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) {
		throw error(401, 'Unauthorized');
	}

	return json(await drainReminders());
};
