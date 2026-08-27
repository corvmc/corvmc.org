import type Stripe from 'stripe';
import { and, eq, isNotNull, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import type { Subscription } from '$lib/server/db/schema/authentication';
import { stripe } from '$lib/server/stripe';
import { buildMemberSubscriptionState } from './subscription-service';
import { allocateCreditsFromInvoice } from './webhook-handlers';
import { syncFromWebhook } from '$lib/server/band/band-subscription-service';
import type { SubscriptionSyncSummary } from '$lib/types/subscription-sync';

// ---------------------------------------------------------------------------
// SubscriptionSyncService — reconcile Stripe subscriptions into local D1
// ---------------------------------------------------------------------------
// Used as a one-time backfill after the Postgres→D1 migration cutover, and as an
// on-demand safety-net re-run (e.g. a missed webhook). Triggered from the staff
// settings page.
//
// STATUS for everyone; CREDITS only for active members, via idempotent replay.
// For every subscription it writes the subscription-status fields (user.subscription,
// band.tier, band.subscription). For active/past_due *members* it additionally
// replays the latest paid invoice through allocateCreditsFromInvoice — the same
// allocation handleInvoicePaid performs, keyed by invoice id. Because that is
// idempotent, it only fixes members whose webhook was missed and NEVER reduces a
// balance already spent down this month.
//
// Stale/canceled members are deliberately NOT touched on the credit side: step 4
// only clears their subscription JSON, never their creditFreeHours/creditEquipment
// (unlike handleSubscriptionDeleted). This module still must NOT call
// recurring-series-service.
// ---------------------------------------------------------------------------

/** Sanity cap — far above expected membership; aborts a runaway sweep. */
const MAX_SUBSCRIPTIONS = 5000;

/** Statuses that should write a subscription snapshot. */
const WRITE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'past_due']);
/** Terminal statuses — a record with ONLY these gets cleared (in step 4). */
const TERMINAL_STATUSES = new Set<Stripe.Subscription.Status>([
	'canceled',
	'unpaid',
	'incomplete_expired'
]);
// A customer/band may hold several subscriptions at once (e.g. an old canceled
// one plus a current active one). To stay order-independent, the sweep NEVER
// clears inline. Instead it records every user/band that has a non-terminal
// subscription in a "keep" set; step 4 then clears exactly the local records
// that hold subscription state but are absent from that set. A canceled sub
// therefore can't undo an active sub seen in the same run, regardless of order.
// Non-terminal-but-ambiguous statuses (trialing, incomplete, paused) are kept
// (not cleared) but do not overwrite local state — counted as `skipped`.

export interface SyncOptions {
	dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// syncAllSubscriptions
// ---------------------------------------------------------------------------

export async function syncAllSubscriptions(
	opts: SyncOptions = {}
): Promise<SubscriptionSyncSummary> {
	const dryRun = opts.dryRun ?? false;

	const summary: SubscriptionSyncSummary = {
		usersUpdated: 0,
		usersCleared: 0,
		bandsUpdated: 0,
		bandsCleared: 0,
		skipped: 0,
		creditsReconciled: 0,
		totalScanned: 0,
		dryRun,
		errors: []
	};

	const seenUserIds = new Set<string>();
	const seenBandIds = new Set<string>();

	// --- Step 1+2+3: sweep all Stripe subscriptions and apply each ----------
	// First auto-paginated `.list` in the repo — `for await` walks every page.
	try {
		for await (const sub of stripe.subscriptions.list({
			status: 'all',
			limit: 100,
			expand: ['data.items', 'data.items.data.price']
		})) {
			summary.totalScanned++;
			if (summary.totalScanned > MAX_SUBSCRIPTIONS) {
				summary.errors.push({
					kind: 'sweep',
					message: `Aborted: exceeded MAX_SUBSCRIPTIONS (${MAX_SUBSCRIPTIONS})`
				});
				break;
			}

			const meta = sub.metadata ?? {};
			try {
				if (meta.subscription_type === 'band_premium' && meta.band_id) {
					await applyBand(sub, meta.band_id, dryRun, summary, seenBandIds);
				} else {
					await applyUser(sub, dryRun, summary, seenUserIds);
				}
			} catch (err) {
				summary.errors.push({
					kind: meta.subscription_type === 'band_premium' ? 'band' : 'user',
					ref: meta.band_id,
					stripeSubscriptionId: sub.id,
					message: err instanceof Error ? err.message : String(err)
				});
			}
		}
	} catch (err) {
		summary.errors.push({
			kind: 'sweep',
			message: `Stripe sweep failed: ${err instanceof Error ? err.message : String(err)}`
		});
	}

	// --- Step 4: reconcile stale local state --------------------------------
	// Clear users/bands that still hold a local subscription but were not seen
	// in the sweep at all (Stripe no longer returns them). Guarded: if the sweep
	// returned nothing (likely an API failure), skip clearing entirely so a
	// transient blip can't mass-wipe local subscription state.
	const sweepFailed = summary.errors.some((e) => e.kind === 'sweep');
	if (summary.totalScanned === 0 || sweepFailed) {
		if (summary.totalScanned === 0) {
			summary.errors.push({
				kind: 'sweep',
				message: 'Sweep returned zero subscriptions — skipping stale-state clearing'
			});
		}
		return summary;
	}

	await clearStaleUsers(seenUserIds, dryRun, summary);
	await clearStaleBands(seenBandIds, dryRun, summary);

	return summary;
}

// ---------------------------------------------------------------------------
// Band branch — reuse the existing webhook sync verbatim
// ---------------------------------------------------------------------------

async function applyBand(
	sub: Stripe.Subscription,
	bandId: string,
	dryRun: boolean,
	summary: SubscriptionSyncSummary,
	seenBandIds: Set<string>
): Promise<void> {
	if (WRITE_STATUSES.has(sub.status)) {
		// Reuse the webhook sync verbatim — sets tier 'premium' + subscription JSON.
		if (!dryRun) await syncFromWebhook(bandId, sub);
		seenBandIds.add(bandId);
		summary.bandsUpdated++;
	} else if (!TERMINAL_STATUSES.has(sub.status)) {
		// trialing / incomplete / paused — keep local state, don't overwrite.
		seenBandIds.add(bandId);
		summary.skipped++;
	}
	// Terminal: do nothing here. If the band still holds local premium state and
	// has no non-terminal sub, step 4 resets it to free.
}

// ---------------------------------------------------------------------------
// User branch — mirror handleInvoicePaid's mapping, WITHOUT credit allocation
// ---------------------------------------------------------------------------

async function applyUser(
	sub: Stripe.Subscription,
	dryRun: boolean,
	summary: SubscriptionSyncSummary,
	seenUserIds: Set<string>
): Promise<void> {
	// Terminal-only subs need no DB lookup — step 4 handles any clearing. Skipping
	// the lookup avoids spurious "no local user" errors for old canceled subs whose
	// customer has since been deleted.
	if (TERMINAL_STATUSES.has(sub.status)) return;

	const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
	if (!customerId) {
		summary.errors.push({
			kind: 'user',
			stripeSubscriptionId: sub.id,
			message: 'Subscription has no customer id'
		});
		return;
	}

	const [member] = await db
		.select({ id: user.id, subscription: user.subscription })
		.from(user)
		.where(eq(user.stripeId, customerId))
		.limit(1);

	if (!member) {
		summary.errors.push({
			kind: 'user',
			ref: customerId,
			stripeSubscriptionId: sub.id,
			message: 'No local user matches this Stripe customer'
		});
		return;
	}

	if (WRITE_STATUSES.has(sub.status)) {
		// Status snapshot — `hoursPerReset` is in credits (30-min blocks) and
		// `startedAt` is preserved for idempotency.
		const existingSub = member.subscription as Subscription | null;
		const subscription = await buildMemberSubscriptionState(sub, existingSub);

		if (!dryRun) await db.update(user).set({ subscription }).where(eq(user.id, member.id));
		seenUserIds.add(member.id);
		summary.usersUpdated++;

		// Credit reconciliation — replay the latest paid invoice through the same
		// allocation handleInvoicePaid performs (idempotent by invoice id, so it
		// only tops up a missed webhook and never reduces a spent-down balance).
		// Isolated in its own try so a credit failure can't roll back the status
		// write above or abort the sweep; it's recorded as a per-user error instead.
		try {
			await reconcileUserCredits(sub, member.id, dryRun, summary);
		} catch (err) {
			summary.errors.push({
				kind: 'user',
				ref: member.id,
				stripeSubscriptionId: sub.id,
				message: `Credit reconciliation failed: ${err instanceof Error ? err.message : String(err)}`
			});
		}
	} else {
		// Non-terminal but ambiguous (trialing / incomplete / paused) — terminal
		// statuses already returned above. Keep local state, don't overwrite.
		seenUserIds.add(member.id);
		summary.skipped++;
	}
	// Clearing of users with no non-terminal sub happens in step 4 — deliberately
	// WITHOUT creditService.setBalance / cancelAllForUser (unlike
	// handleSubscriptionDeleted, webhook-handlers.ts).
}

/**
 * Replay the member's latest paid invoice to allocate any missed monthly credits.
 * No-op when the member has no paid invoice yet. Increments `creditsReconciled`
 * only when an allocation was newly applied (i.e. the webhook had been missed).
 */
async function reconcileUserCredits(
	sub: Stripe.Subscription,
	memberId: string,
	dryRun: boolean,
	summary: SubscriptionSyncSummary
): Promise<void> {
	const { data } = await stripe.invoices.list({
		subscription: sub.id,
		status: 'paid',
		limit: 1
	});
	const paid = data[0];
	if (!paid) return;

	const { reconciled } = await allocateCreditsFromInvoice(memberId, paid, { dryRun });
	if (reconciled) summary.creditsReconciled++;
}

// ---------------------------------------------------------------------------
// Stale-state reconciliation (credit-free)
// ---------------------------------------------------------------------------

async function clearStaleUsers(
	seenUserIds: Set<string>,
	dryRun: boolean,
	summary: SubscriptionSyncSummary
): Promise<void> {
	const seen = [...seenUserIds];
	const where =
		seen.length > 0
			? and(isNotNull(user.subscription), notInArray(user.id, seen))
			: isNotNull(user.subscription);

	const stale = await db.select({ id: user.id }).from(user).where(where);

	for (const row of stale) {
		// Status snapshot only — clear the subscription JSON, never the credits.
		if (!dryRun) await db.update(user).set({ subscription: null }).where(eq(user.id, row.id));
		summary.usersCleared++;
	}
}

async function clearStaleBands(
	seenBandIds: Set<string>,
	dryRun: boolean,
	summary: SubscriptionSyncSummary
): Promise<void> {
	const seen = [...seenBandIds];
	const where =
		seen.length > 0
			? and(isNotNull(group.subscription), notInArray(group.id, seen))
			: isNotNull(group.subscription);

	const stale = await db.select({ id: group.id }).from(group).where(where);

	for (const row of stale) {
		if (!dryRun)
			await db
				.update(group)
				.set({ tier: 'free', subscription: null, updatedAt: new Date() })
				.where(eq(group.id, row.id));
		summary.bandsCleared++;
	}
}
