import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { eq } from 'drizzle-orm';
import * as creditService from './credit-service';
import { DOLLARS_PER_UNIT } from '$lib/config';
import { cancelAllForUser } from '$lib/server/reservation/recurring-series-service';
import { buildMemberSubscriptionState } from './subscription-service';
import { syncFromWebhook } from '$lib/server/band/band-subscription-service';
import { registeredEvents, type RegisteredEvent } from './webhook-events';
import { getStripeProductId } from './product-config-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import type { Subscription } from '$lib/server/db/schema/authentication';

// Re-export so downstream consumers can import from one place
export { registeredEvents };

// ---------------------------------------------------------------------------
// Webhook event handlers
// ---------------------------------------------------------------------------
// These are called by the webhook route after signature verification.
// Each handler is responsible for one event type.
//
// checkout.session.completed emits a domain event — listeners are registered
// in register-listeners.ts. This file handles finance-specific events
// (credit allocation and subscription lifecycle) directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Webhook handler map
// ---------------------------------------------------------------------------

export type WebhookHandlerFn = (data: any) => Promise<void>;

export const webhookHandlerMap: Record<RegisteredEvent, WebhookHandlerFn> = {
	'checkout.session.completed': handleCheckoutCompleted,
	'invoice.paid': handleInvoicePaid,
	'customer.subscription.updated': handleSubscriptionUpdated,
	'customer.subscription.deleted': handleSubscriptionDeleted
};

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
	await domainEvents.emit('checkout.completed', {
		sessionId: session.id,
		metadata: (session.metadata as Record<string, string>) ?? {},
		stripeSession: session
	});
}

// ---------------------------------------------------------------------------
// invoice.paid — allocate monthly credits from subscription
// ---------------------------------------------------------------------------

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
	// Only process subscription invoices
	const subDetails = invoice.parent?.subscription_details;
	if (!subDetails) return;

	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

	if (!customerId) return;

	const member = await findUserByStripeId(customerId);
	if (!member) {
		console.warn(`invoice.paid: no user found for Stripe customer ${customerId}`);
		return;
	}

	const contributionLine = await findContributionLine(invoice);
	if (!contributionLine) {
		console.warn(`invoice.paid: no contribution line item found for invoice ${invoice.id}`);
		return;
	}

	// Allocate free-hour + equipment credits from this invoice (idempotent by id).
	await allocateCreditsFromInvoice(member.id, invoice);

	const [existing] = await db
		.select({ subscription: user.subscription })
		.from(user)
		.where(eq(user.id, member.id))
		.limit(1);

	const nextReset = contributionLine.period?.end
		? new Date(contributionLine.period.end * 1000).toISOString()
		: new Date(Date.now() + 30 * 86400_000).toISOString();

	// A fee-coverage line is a second subscription line item alongside the
	// contribution line (prorations excluded — they aren't fee lines). Renewals
	// don't cancel, so preserve cancelAtPeriodEnd.
	const coveringFees = contributionCandidates(invoice).some((line) => line !== contributionLine);

	const existingSub = existing?.subscription as Subscription | null;
	const subscription: Subscription = {
		startedAt: existingSub?.startedAt ?? new Date().toISOString(),
		stripeSubscriptionId:
			typeof subDetails.subscription === 'string'
				? subDetails.subscription
				: (subDetails.subscription?.id ?? ''),
		hoursPerReset: freeHoursCreditsFromLine(contributionLine),
		creditsResetAt: nextReset,
		coveringFees,
		cancelAtPeriodEnd: existingSub?.cancelAtPeriodEnd ?? false
	};

	await db.update(user).set({ subscription }).where(eq(user.id, member.id));
}

// ---------------------------------------------------------------------------
// customer.subscription.updated — sync band premium or member subscription
// ---------------------------------------------------------------------------

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
	const metadata = subscription.metadata ?? {};

	// Band premium subscription
	if (metadata.subscription_type === 'band_premium' && metadata.band_id) {
		await syncFromWebhook(metadata.band_id, subscription);
		return;
	}

	// User subscription update — refresh the status snapshot so cancel/resume and
	// quantity changes reflect immediately on the membership page. Credits are owned
	// by invoice.paid / subscription.deleted, so this makes NO creditService.* calls.
	if (subscription.status !== 'active' && subscription.status !== 'past_due') return;

	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
	if (!customerId) return;

	const [member] = await db
		.select({ id: user.id, subscription: user.subscription })
		.from(user)
		.where(eq(user.stripeId, customerId))
		.limit(1);
	if (!member) return;

	const existingSub = member.subscription as Subscription | null;
	const next = await buildMemberSubscriptionState(subscription, existingSub);
	await db.update(user).set({ subscription: next }).where(eq(user.id, member.id));
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted — reset credits or downgrade band
// ---------------------------------------------------------------------------

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	const metadata = subscription.metadata ?? {};

	// Band premium subscription deleted
	if (metadata.subscription_type === 'band_premium' && metadata.band_id) {
		await syncFromWebhook(metadata.band_id, subscription);
		return;
	}

	// User subscription deleted — reset credits
	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

	const member = await findUserByStripeId(customerId);
	if (!member) {
		console.warn(`subscription.deleted: no user found for Stripe customer ${customerId}`);
		return;
	}

	await creditService.setBalance(
		member.id,
		'free_hours',
		0,
		'monthly_allocation',
		subscription.id,
		'Subscription cancelled — free hours reset'
	);

	await creditService.setBalance(
		member.id,
		'equipment_credits',
		0,
		'monthly_allocation',
		subscription.id,
		'Subscription cancelled — equipment credits reset'
	);

	// Cancel all active recurring series for this user
	await cancelAllForUser(member.id);

	await db.update(user).set({ subscription: null }).where(eq(user.id, member.id));
}

// ---------------------------------------------------------------------------
// Credit allocation from an invoice (shared by webhook + subscription sync)
// ---------------------------------------------------------------------------

/** Product id on an invoice line (v22: `pricing.price_details.product`). */
function lineProductId(line: Stripe.InvoiceLineItem): string | undefined {
	return line.pricing?.price_details?.product ?? undefined;
}

/** Whether an invoice line is a proration adjustment (quantity/plan changes). */
function isProrationLine(line: Stripe.InvoiceLineItem): boolean {
	return line.parent?.subscription_item_details?.proration === true;
}

/**
 * Subscription lines that can carry the member's contribution: non-proration
 * subscription-item lines with a positive quantity. Excludes proration
 * adjustments (mid-cycle quantity changes) and one-off invoice items.
 */
function contributionCandidates(invoice: Stripe.Invoice): Stripe.InvoiceLineItem[] {
	return (invoice.lines?.data ?? []).filter(
		(line) =>
			line.parent?.subscription_item_details != null &&
			line.quantity != null &&
			line.quantity > 0 &&
			!isProrationLine(line)
	);
}

/**
 * Find the contribution line item on a subscription invoice. A fee-coverage
 * subscription also matches the naive "subscription line with quantity > 0"
 * predicate and Stripe does not guarantee line ordering, so when several
 * candidates exist the fee line is excluded by product id and the
 * largest-amount line wins (the fee — ~3% + 30¢ — is always smaller than the
 * contribution it covers). Mirrors `findContributionItem` in
 * subscription-service.ts, which fixed the same bug for subscription items.
 */
async function findContributionLine(
	invoice: Stripe.Invoice
): Promise<Stripe.InvoiceLineItem | undefined> {
	const candidates = contributionCandidates(invoice);
	if (candidates.length <= 1) return candidates[0];

	let feeProductId: string | undefined;
	try {
		feeProductId = await getStripeProductId('fee_coverage');
	} catch {
		// Fee product unresolvable (KV/Stripe hiccup) — the largest-amount
		// fallback below still picks the contribution over the smaller fee line.
	}

	const nonFee = candidates.filter(
		(line) => feeProductId == null || lineProductId(line) !== feeProductId
	);
	const pool = nonFee.length > 0 ? nonFee : candidates;
	return pool.reduce((best, line) => ((line.amount ?? 0) > (best.amount ?? 0) ? line : best));
}

/**
 * Free-hour credits granted by a contribution line. Derived from the line's
 * dollar amount, not the raw quantity — a contribution may be billed as 12 × $5
 * or as a single 1 × $60 line. $5 = 1 hour = 2 credits.
 */
function freeHoursCreditsFromLine(line: Stripe.InvoiceLineItem): number {
	return Math.round((line.amount ?? 0) / (DOLLARS_PER_UNIT * 50));
}

/**
 * Parse a subscription invoice's contribution line and allocate the matching
 * free-hour + equipment credits. Idempotent by invoice id (a no-op if already
 * applied, or if the invoice has no contribution line / id). Returns whether an
 * allocation was newly applied — used for sync reporting and dry-run prediction.
 *
 * Shared by `handleInvoicePaid` (live webhook) and the staff subscription sync,
 * so both derive credits the same way.
 */
export async function allocateCreditsFromInvoice(
	memberId: string,
	invoice: Stripe.Invoice,
	opts: { dryRun?: boolean } = {}
): Promise<{ reconciled: boolean }> {
	const contributionLine = await findContributionLine(invoice);
	if (!contributionLine || !invoice.id) return { reconciled: false };

	// Whether this invoice has already been allocated. Checked before writing so
	// the return value reports what THIS run actually did (and powers dry-run).
	const alreadyApplied = await creditService.hasTransaction('monthly_allocation', invoice.id);

	if (opts.dryRun) return { reconciled: !alreadyApplied };

	const contributionCents = contributionLine.amount ?? 0;
	const freeHoursCredits = Math.round(contributionCents / (DOLLARS_PER_UNIT * 50));

	// Use invoice ID as sourceId for idempotency — each invoice is unique.
	await creditService.allocateMonthlyCredits(memberId, freeHoursCredits, invoice.id);
	// Equipment credits are denominated in cents: every dollar contributed is
	// spendable 1:1 against equipment-loan charges (see settleReturn). Capped per
	// config (creditTypeConfig.equipment_credits.maxBalance).
	await creditService.allocateEquipmentCredits(memberId, contributionCents, invoice.id);

	return { reconciled: !alreadyApplied };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findUserByStripeId(stripeCustomerId: string) {
	const [found] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.stripeId, stripeCustomerId))
		.limit(1);

	return found ?? null;
}
