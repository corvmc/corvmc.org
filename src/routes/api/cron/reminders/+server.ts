import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { drainReminders } from '#lib/server/reminders/drain.js';
import { sendInAppDigest } from '#lib/server/notification/digest.js';
import { announceOpenShifts } from '#lib/server/volunteer/open-shift-fanout.js';
import { captureException } from '#lib/server/sentry.js';

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

	const reminders = await drainReminders();
	// The open-shift digest (#3239), once a day from 9am club time (#3258); every
	// other pass returns early. Its own fan-out rather than a registry
	// digest: the registry emits once per member, which is a dispatch each, and a
	// role can have a roster's worth of members.
	let openShifts: Awaited<ReturnType<typeof announceOpenShifts>> | { failed: true };
	try {
		openShifts = await announceOpenShifts();
	} catch (err) {
		captureException(err, { event: 'volunteer.shift_opened' });
		openShifts = { failed: true };
	}
	// The in-app digest (#3409): held notices, one summary row per member, same
	// 9am latch. In-app only, so a failure here never touches the email above.
	let inAppDigest: Awaited<ReturnType<typeof sendInAppDigest>> | { failed: true };
	try {
		inAppDigest = await sendInAppDigest();
	} catch (err) {
		captureException(err, { event: 'notification.in_app_digest' });
		inAppDigest = { failed: true };
	}
	return Response.json({ ...reminders, openShifts, inAppDigest });
};
