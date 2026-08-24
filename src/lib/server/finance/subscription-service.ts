import type Stripe from 'stripe';
import { eq, getColumnTable, getTableName, sql, type AnyColumn } from 'drizzle-orm';
import { stripe } from '$lib/server/stripe';
import { db } from '$lib/server/db';
import { user, type Subscription } from '$lib/server/db/schema/authentication';
import { DOLLARS_PER_UNIT } from '$lib/config';
import { checkout } from './payment-service';
import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
import {
	getProductConfig,
	getStripeProductId,
	buildSubscriptionLineItem
} from './product-config-service';

// ---------------------------------------------------------------------------
// SubscriptionService — manages Stripe subscription lifecycle
// ---------------------------------------------------------------------------
// Subscription creation delegates to the shared checkout() with
// mode: 'subscription'. This file handles lifecycle operations:
// getSubscription, updateQuantity, cancel, resume.
//
// All pricing uses inline price_data from the product config (KV-backed). No
// stored Stripe Price IDs — unit amounts are read from KV at checkout time.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an operation can't proceed because the Stripe subscription isn't
 * in the expected state — no active subscription, or a missing line item. These
 * are expected conflicts (stale UI, mid-cancellation), not server faults.
 */
export class SubscriptionStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SubscriptionStateError';
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSubscriptionOptions {
	userId: string;
	stripeCustomerId: string;
	quantity: number;
	coverFees: boolean;
	successUrl: string;
	cancelUrl: string;
}

export interface SubscriptionInfo {
	id: string;
	status: string;
	quantity: number;
	coveringFees: boolean;
	currentPeriodEnd: Date;
	cancelAtPeriodEnd: boolean;
}

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------

/**
 * Create a subscription checkout via the shared checkout() flow.
 * Returns the checkout URL for redirect.
 */
export async function createCheckoutSession(options: CreateSubscriptionOptions): Promise<string> {
	const { userId, stripeCustomerId, quantity, coverFees, successUrl, cancelUrl } = options;

	if (quantity < 1) throw new Error('Quantity must be at least 1');

	const config = await getProductConfig('contribution');
	const lineItem = await buildSubscriptionLineItem(
		'contribution',
		config.unitAmountCents,
		quantity
	);

	const result = await checkout({
		userId,
		stripeCustomerId,
		mode: 'subscription',
		lineItems: [lineItem],
		coverFees,
		metadata: {
			subscription_type: 'contribution'
		},
		successUrl,
		cancelUrl
	});

	if (!result.checkoutUrl) {
		throw new Error('Stripe did not return a checkout URL');
	}

	return result.checkoutUrl;
}

// ---------------------------------------------------------------------------
// getSubscription
// ---------------------------------------------------------------------------

/** Resolve a subscription item's product id (price.product may be expanded). */
function itemProductId(item: Stripe.SubscriptionItem): string | undefined {
	const product = item.price.product;
	return typeof product === 'string' ? product : product?.id;
}

/**
 * Locate the contribution line item on a subscription. Prefers an exact product-id
 * match; if that fails (product ids can drift after a KV/product-config migration),
 * falls back to the largest-quantity line that is NOT the fee-coverage line — the
 * fee line is always quantity 1, so a naive "first quantity>0" fallback can wrongly
 * pick it. Returns undefined only when no usable line exists.
 */
function findContributionItem(
	items: Stripe.SubscriptionItem[],
	contributionProductId: string,
	feeProductId: string
): Stripe.SubscriptionItem | undefined {
	const byProduct = items.find((i) => itemProductId(i) === contributionProductId);
	if (byProduct) return byProduct;

	const nonFee = items
		.filter((i) => itemProductId(i) !== feeProductId && (i.quantity ?? 0) > 0)
		.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0));
	return nonFee[0] ?? items.find((i) => (i.quantity ?? 0) > 0);
}

/**
 * Credits (30-min blocks) granted by a contribution line. Derived from the dollar
 * amount (`unit_amount × quantity`), NOT the raw Stripe quantity — a contribution
 * can be billed as 12 × $5 or as a single 1 × $60 line, and both must yield the
 * same allocation. $5 = 1 hour = 2 credits, so credits = cents / (DOLLARS_PER_UNIT × 50).
 */
function contributionCreditsFromItem(item: Stripe.SubscriptionItem | undefined): number {
	const cents = (item?.price.unit_amount ?? 0) * (item?.quantity ?? 0);
	return Math.round(cents / (DOLLARS_PER_UNIT * 50));
}

/**
 * Fetch the active subscription for a user. Returns null if none exists.
 */
export async function getSubscription(stripeCustomerId: string): Promise<SubscriptionInfo | null> {
	const subscriptions = await stripe.subscriptions.list({
		customer: stripeCustomerId,
		status: 'active',
		limit: 1,
		expand: ['data.items']
	});

	const sub = subscriptions.data[0];
	if (!sub) return null;

	const contributionProductId = await getStripeProductId('contribution');
	const feeProductId = await getStripeProductId('fee_coverage');

	// `quantity` here is the $5-unit count (not credits).
	const contributionItem = findContributionItem(
		sub.items.data,
		contributionProductId,
		feeProductId
	);
	const feeItem = sub.items.data.find((item) => itemProductId(item) === feeProductId);

	// In Stripe v22, current_period_end moved to subscription items
	const periodEnd = contributionItem?.current_period_end ?? 0;

	return {
		id: sub.id,
		status: sub.status,
		quantity: contributionItem?.quantity ?? 0,
		coveringFees: feeItem != null,
		currentPeriodEnd: new Date(periodEnd * 1000),
		cancelAtPeriodEnd: sub.cancel_at_period_end
	};
}

// ---------------------------------------------------------------------------
// Subscription state mapping (DB-backed source of truth)
// ---------------------------------------------------------------------------

/**
 * Build the `user.subscription` JSON snapshot from a Stripe subscription.
 * `hoursPerReset` is stored in credits (30-min blocks): each $5-unit grants one
 * hour = two credits, so `credits = contribution quantity × 2`. Preserves the
 * existing `startedAt` so re-runs stay idempotent.
 */
export async function buildMemberSubscriptionState(
	sub: Stripe.Subscription,
	existing: Subscription | null
): Promise<NonNullable<Subscription>> {
	const contributionProductId = await getStripeProductId('contribution');
	const feeProductId = await getStripeProductId('fee_coverage');

	const contributionItem = findContributionItem(
		sub.items.data,
		contributionProductId,
		feeProductId
	);
	const coveringFees = sub.items.data.some((i) => itemProductId(i) === feeProductId);

	const periodEnd = contributionItem?.current_period_end;

	return {
		startedAt: existing?.startedAt ?? new Date().toISOString(),
		stripeSubscriptionId: sub.id,
		hoursPerReset: contributionCreditsFromItem(contributionItem),
		creditsResetAt: periodEnd
			? new Date(periodEnd * 1000).toISOString()
			: (existing?.creditsResetAt ?? new Date(Date.now() + 30 * 86400_000).toISOString()),
		coveringFees,
		cancelAtPeriodEnd: sub.cancel_at_period_end
	};
}

/**
 * Map a stored `user.subscription` JSON to the `SubscriptionInfo` shape the
 * membership UI consumes. `quantity` is returned in $5-units (= credits / 2) so
 * the dollar figure (`quantity × DOLLARS_PER_UNIT`) and "free practice hours"
 * labels stay correct. Returns null when the member has no active subscription.
 */
export function mapDbSubscription(sub: Subscription | null): SubscriptionInfo | null {
	if (!sub) return null;
	return {
		id: sub.stripeSubscriptionId,
		status: 'active',
		quantity: sub.hoursPerReset / 2,
		coveringFees: sub.coveringFees ?? false,
		currentPeriodEnd: new Date(sub.creditsResetAt),
		cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false
	};
}

/** Read a member's subscription snapshot from the DB (source of truth). */
export async function getMemberSubscription(userId: string): Promise<Subscription | null> {
	const [row] = await db
		.select({ subscription: user.subscription })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return (row?.subscription as Subscription | null) ?? null;
}

/**
 * Whether a user is a sustaining member. A non-null `user.subscription` snapshot is
 * the single source of truth — the legacy `sustaining member` role is not maintained
 * by the Stripe flow and must not be used for status checks.
 */
export async function isSustainingMember(userId: string): Promise<boolean> {
	return (await getMemberSubscription(userId)) != null;
}

/**
 * SQL fragment that evaluates to a boolean: true when the user has a subscription
 * snapshot. Use inside a drizzle `.select()` to compute the flag inline for list/detail
 * queries, e.g. `sustaining: isSustainingMemberSql(user.id)`. Mirrors `primaryRoleFor`.
 *
 * The outer reference is qualified manually: drizzle renders an interpolated Column
 * unqualified in single-table select lists, and inside this subquery the bare name
 * would bind to the inner `u` alias (`u.id = u.id`, always true), giving every outer
 * row the first table row's flag.
 */
export function isSustainingMemberSql(userIdCol: AnyColumn) {
	const outerRef = sql.raw(`"${getTableName(getColumnTable(userIdCol))}"."${userIdCol.name}"`);
	return sql<boolean>`(
		select case when u.subscription is not null then 1 else 0 end
		from ${user} u where u.id = ${outerRef}
	)`;
}

/**
 * Merge a partial update into the member's stored subscription snapshot. Used for
 * write-through after a Stripe mutation so the UI reflects the change before the
 * webhook lands. No-op if the member has no subscription.
 */
export async function patchMemberSubscription(
	userId: string,
	patch: Partial<Subscription>
): Promise<void> {
	const existing = await getMemberSubscription(userId);
	if (!existing) return;
	await db
		.update(user)
		.set({ subscription: { ...existing, ...patch } })
		.where(eq(user.id, userId));
}

// ---------------------------------------------------------------------------
// updateQuantity
// ---------------------------------------------------------------------------

/**
 * Update the contribution quantity (and optionally fee coverage).
 * Stripe handles proration automatically.
 */
export async function updateQuantity(
	stripeCustomerId: string,
	newQuantity: number,
	coverFees: boolean
): Promise<void> {
	if (newQuantity < 1) throw new Error('Quantity must be at least 1');

	const subscriptions = await stripe.subscriptions.list({
		customer: stripeCustomerId,
		status: 'active',
		limit: 1
	});

	const sub = subscriptions.data[0];
	if (!sub) throw new SubscriptionStateError('No active subscription found');

	const contributionProductId = await getStripeProductId('contribution');
	const feeProductId = await getStripeProductId('fee_coverage');

	// Use the same drift-tolerant lookup as getSubscription(): a strict product-id
	// match misses the contribution line whenever the product id has drifted (e.g.
	// after a product-config migration), which is what surfaced as the
	// "Contribution item not found on subscription" error in production.
	const contributionItem = findContributionItem(
		sub.items.data,
		contributionProductId,
		feeProductId
	);

	if (!contributionItem)
		throw new SubscriptionStateError('Contribution item not found on subscription');

	// Treat every line that ISN'T the contribution line as a fee line and delete
	// them all. A strict `product === feeProductId` match misses fee lines whose
	// product id has drifted after a product-config migration, so the stale line
	// was never removed and a fresh one was appended — billing the member for two
	// "Processing Fee Coverage" lines. Identifying fee lines by exclusion (and
	// deleting every match, not just the first) collapses any accumulated
	// duplicates back to a single line.
	const feeItems = sub.items.data.filter((item) => item.id !== contributionItem.id);

	const contributionConfig = await getProductConfig('contribution');

	const items: Array<{
		id?: string;
		price_data?: {
			currency: string;
			product: string;
			unit_amount: number;
			recurring: { interval: string };
		};
		quantity?: number;
		deleted?: boolean;
	}> = [
		// Always restate the unit price from config rather than only setting the
		// quantity. Legacy subscriptions were billed as 1 × full-dollar-amount
		// (e.g. unit_amount 6000, quantity 1); setting quantity alone on such a
		// line would multiply the stale $60 unit by the new $5-unit count and bill
		// 12 × $60 = $720. Normalizing unit_amount to the $5/unit price keeps
		// `unit_amount × quantity` correct regardless of how the line was created.
		{
			id: contributionItem.id,
			price_data: {
				currency: 'usd',
				product: contributionProductId,
				unit_amount: contributionConfig.unitAmountCents,
				recurring: { interval: 'month' }
			},
			quantity: newQuantity
		}
	];

	// Remove any existing fee lines first (handles drift and accumulated duplicates).
	for (const feeItem of feeItems) {
		items.push({ id: feeItem.id, deleted: true });
	}

	if (coverFees) {
		const contributionCents = newQuantity * contributionConfig.unitAmountCents;
		const { feeCents } = calculateTotalWithFeeCoverage(contributionCents);

		items.push({
			price_data: {
				currency: 'usd',
				product: feeProductId,
				unit_amount: feeCents,
				recurring: { interval: 'month' }
			},
			quantity: 1
		});
	}

	// @ts-expect-error — Stripe v22 Item type requires all fields; we only send
	// the subset needed for quantity update + price_data fee items + deleted flags.
	await stripe.subscriptions.update(sub.id, { items });
}

// ---------------------------------------------------------------------------
// cancel / resume
// ---------------------------------------------------------------------------

/**
 * Cancel the subscription at the end of the current billing period.
 */
export async function cancel(stripeCustomerId: string): Promise<void> {
	const subscriptions = await stripe.subscriptions.list({
		customer: stripeCustomerId,
		status: 'active',
		limit: 1
	});

	const sub = subscriptions.data[0];
	if (!sub) throw new SubscriptionStateError('No active subscription found');

	await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
}

/**
 * Resume a subscription that was cancelled but hasn't reached period end yet.
 */
export async function resume(stripeCustomerId: string): Promise<void> {
	const subscriptions = await stripe.subscriptions.list({
		customer: stripeCustomerId,
		status: 'active',
		limit: 1
	});

	const sub = subscriptions.data[0];
	if (!sub) throw new SubscriptionStateError('No active subscription found');

	if (!sub.cancel_at_period_end) {
		throw new Error('Subscription is not scheduled for cancellation');
	}

	await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
}

// ---------------------------------------------------------------------------
// Billing portal
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Billing Portal session URL. Returns null if no customer ID
 * is provided. The portal lets members manage payment methods, view invoices,
 * and cancel subscriptions.
 */
export async function createBillingPortalUrl(
	stripeCustomerId: string | null | undefined,
	returnUrl: string
): Promise<string | null> {
	if (!stripeCustomerId) return null;

	const session = await stripe.billingPortal.sessions.create({
		customer: stripeCustomerId,
		return_url: returnUrl
	});

	return session.url;
}
