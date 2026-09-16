import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { lastClosedWeek, reconcileStripeWindow } from '$lib/server/finance/reconciliation';

/**
 * Compare last week's record against what hit the Stripe balance (#1183).
 * Raises to Sentry only past `LEDGER_RECONCILE_THRESHOLD_CENTS`, loose until
 * somebody has watched a few weeks of real deltas.
 *
 * Invoked by the cron `scheduled` handler; callable manually:
 *   POST /api/cron/reconcile-ledger  ·  Authorization: Bearer <CRON_SECRET>
 */
const DEFAULT_THRESHOLD_CENTS = 100_00;

export const POST: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (!secret) throw error(500, 'CRON_SECRET not configured');

	const auth = request.headers.get('Authorization');
	if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');

	const threshold = Number(env.LEDGER_RECONCILE_THRESHOLD_CENTS) || DEFAULT_THRESHOLD_CENTS;
	const range = lastClosedWeek();

	return json({
		from: range.from.toISOString(),
		to: range.to.toISOString(),
		...(await reconcileStripeWindow(range, threshold))
	});
};
