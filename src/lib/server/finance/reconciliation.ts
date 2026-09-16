import { stripe } from '$lib/server/stripe';
import { stripeSettledCents, type RangeFilter } from './financial-entry-service';
import { captureException } from '$lib/server/sentry';

/**
 * Does the record still agree with Stripe? (#1183)
 *
 * The map and the lint rule fence what gets written. Neither notices a writer
 * that silently stops firing, or an amount recorded wrong rather than not at
 * all — only comparing totals does.
 */

/**
 * Balance transactions, not charges.
 *
 * A music sale is a Connect destination charge: `charges.list` reports the
 * whole amount while the ledger records only the application fee, because the
 * band's share never sits in the collective's balance (#1175). The balance is
 * what the collective actually holds, which is what the ledger describes.
 */
const COUNTED_TYPES = new Set([
	'charge',
	'payment',
	'refund',
	'payment_refund',
	'application_fee',
	'application_fee_refund',
	'stripe_fee',
	'adjustment'
]);

export interface Reconciliation {
	ledgerCents: number;
	stripeCents: number;
	deltaCents: number;
	/** Types seen in the window, so an uncounted one is visible rather than silent. */
	seenTypes: Record<string, number>;
}

/**
 * What hit the platform balance over the window.
 *
 * `payout` is money to the bank and `transfer` is a Connect payout — neither
 * is revenue leaving. An uncounted type still lands in `seenTypes`, so one
 * nobody anticipated is a number to look at rather than silently missing.
 */
async function stripeBalanceCents(range: RangeFilter): Promise<{
	cents: number;
	seenTypes: Record<string, number>;
}> {
	const seenTypes: Record<string, number> = {};
	let cents = 0;

	const params = {
		created: {
			gte: Math.floor(range.from.getTime() / 1000),
			lte: Math.floor(range.to.getTime() / 1000)
		},
		limit: 100
	};

	for await (const tx of stripe.balanceTransactions.list(params)) {
		seenTypes[tx.type] = (seenTypes[tx.type] ?? 0) + 1;
		if (COUNTED_TYPES.has(tx.type)) cents += tx.net;
	}

	return { cents, seenTypes };
}

/**
 * Report, do not assert.
 *
 * The type filter above cannot be validated from a test — it needs a pass
 * against the real account. So this returns the numbers every run and only
 * raises above a threshold a human has set after watching real deltas.
 */
export async function reconcileStripeWindow(
	range: RangeFilter,
	thresholdCents: number
): Promise<Reconciliation> {
	const [ledgerCents, stripeSide] = await Promise.all([
		stripeSettledCents(range),
		stripeBalanceCents(range)
	]);

	const result: Reconciliation = {
		ledgerCents,
		stripeCents: stripeSide.cents,
		deltaCents: ledgerCents - stripeSide.cents,
		seenTypes: stripeSide.seenTypes
	};

	if (Math.abs(result.deltaCents) > thresholdCents) {
		captureException(
			new Error(`Financial record and Stripe disagree by ${result.deltaCents} cents`),
			{
				event: 'financial-entry.reconcile',
				from: range.from.toISOString(),
				to: range.to.toISOString(),
				...result
			}
		);
	}

	return result;
}

/** The week that ended at midnight UTC this morning — closed, never partial. */
export function lastClosedWeek(now: Date = new Date()): RangeFilter {
	const to = new Date(now);
	to.setUTCHours(0, 0, 0, 0);
	const from = new Date(to);
	from.setUTCDate(from.getUTCDate() - 7);
	return { from, to };
}
