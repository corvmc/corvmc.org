import { db } from '$lib/server/db';
import { bandSite } from '$lib/server/db/schema/band-site';
import { bandSubscriptionSchema, type BandSubscription } from '$lib/server/db/schema/band-site';
import { stripe } from '$lib/server/stripe';
import { checkout } from '$lib/server/finance/payment-service';
import {
	buildSubscriptionLineItem,
	getProductConfig
} from '$lib/server/finance/product-config-service';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// BandSubscriptionService — manages premium band tier via Stripe
// ---------------------------------------------------------------------------

const YEARLY_DISCOUNT_MONTHS = 2; // yearly = 10 months cost (2 free)

export interface BandPremiumPricing {
	monthlyCents: number;
	yearlyCents: number;
	/** Months free on the yearly plan, for the badge the upsell renders. */
	yearlyMonthsFree: number;
}

/**
 * The prices the upsell advertises and checkout charges — one calculation, so
 * they cannot drift.
 *
 * They did drift: the page hardcoded "$15/mo" and "$120/yr" while checkout read
 * `getProductConfig('band_premium')`, so editing the price in Staff Settings →
 * Pricing would have left the page quoting the old number and the checkout
 * taking the new one.
 */
export async function getBandPremiumPricing(): Promise<BandPremiumPricing> {
	const config = await getProductConfig('band_premium');
	return {
		monthlyCents: config.unitAmountCents,
		yearlyCents: config.unitAmountCents * (12 - YEARLY_DISCOUNT_MONTHS),
		yearlyMonthsFree: YEARLY_DISCOUNT_MONTHS
	};
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface BandCheckoutOptions {
	bandId: string;
	stripeCustomerId: string;
	billingInterval: 'monthly' | 'yearly';
	successUrl: string;
	cancelUrl: string;
}

/**
 * Create a Stripe checkout session for band premium subscription.
 * Returns the checkout URL for redirect.
 */
export async function createBandPremiumCheckout(options: BandCheckoutOptions): Promise<string> {
	const { bandId, stripeCustomerId, billingInterval, successUrl, cancelUrl } = options;

	const pricing = await getBandPremiumPricing();
	const interval = billingInterval === 'yearly' ? 'year' : 'month';
	const unitAmount = billingInterval === 'yearly' ? pricing.yearlyCents : pricing.monthlyCents;

	const lineItem = await buildSubscriptionLineItem('band_premium', unitAmount, 1, interval);

	const result = await checkout({
		stripeCustomerId,
		mode: 'subscription',
		lineItems: [lineItem],
		coverFees: false,
		metadata: {
			subscription_type: 'band_premium',
			band_id: bandId
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
// Webhook sync
// ---------------------------------------------------------------------------

/**
 * Called from the Stripe webhook handler when a band_premium subscription event fires.
 * Updates the band's subscription JSON and tier column.
 */
export async function syncFromWebhook(
	bandId: string,
	stripeSubscription: {
		id: string;
		status: string;
		cancel_at_period_end: boolean;
		items?: {
			data: Array<{
				current_period_end?: number | null;
				price?: { recurring?: { interval?: string } | null } | null;
			}>;
		};
	}
): Promise<void> {
	const { id, status, cancel_at_period_end, items } = stripeSubscription;

	// In Stripe v22, current_period_end lives on the subscription item
	const firstItem = items?.data[0];
	const currentPeriodEnd = firstItem?.current_period_end;

	// Determine billing interval from subscription items
	const interval = firstItem?.price?.recurring?.interval;
	const billingInterval: 'monthly' | 'yearly' = interval === 'year' ? 'yearly' : 'monthly';

	if (status === 'active' || status === 'past_due') {
		const subscription: BandSubscription = {
			startedAt: new Date().toISOString(),
			stripeSubscriptionId: id,
			billingInterval,
			currentPeriodEnd: currentPeriodEnd
				? new Date(currentPeriodEnd * 1000).toISOString()
				: new Date(Date.now() + 30 * 86400_000).toISOString(),
			cancelAtPeriodEnd: cancel_at_period_end
		};

		await db
			.update(bandSite)
			.set({
				tier: 'premium',
				subscription: subscription as BandSubscription,
				updatedAt: new Date()
			})
			.where(eq(bandSite.groupId, bandId));
	} else if (status === 'canceled' || status === 'unpaid') {
		// Downgrade, not delete. The row stays and keeps `band_page_config` and
		// `band_media` alive, so a band that cancels — or whose card simply
		// lapses — still has its blocks, theme, CSS, EPK and images when it comes
		// back. Deleting the row here would cascade all of it away.
		await db
			.update(bandSite)
			.set({
				tier: 'free',
				subscription: null,
				updatedAt: new Date()
			})
			.where(eq(bandSite.groupId, bandId));
	}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Cancel the band's premium subscription at period end.
 */
export async function cancelBandSubscription(bandId: string): Promise<void> {
	const [bandRow] = await db
		.select({ subscription: bandSite.subscription })
		.from(bandSite)
		.where(eq(bandSite.groupId, bandId))
		.limit(1);

	if (!bandRow?.subscription) throw new Error('No active band subscription');

	const parsed = bandSubscriptionSchema.parse(bandRow.subscription);
	if (!parsed) throw new Error('No active band subscription');

	await stripe.subscriptions.update(parsed.stripeSubscriptionId, {
		cancel_at_period_end: true
	});

	// Optimistic update — webhook will confirm
	const updated: BandSubscription = { ...parsed, cancelAtPeriodEnd: true };
	await db
		.update(bandSite)
		.set({
			subscription: updated as BandSubscription,
			updatedAt: new Date()
		})
		.where(eq(bandSite.groupId, bandId));
}

/**
 * Resume a band subscription that was scheduled for cancellation.
 */
export async function resumeBandSubscription(bandId: string): Promise<void> {
	const [bandRow] = await db
		.select({ subscription: bandSite.subscription })
		.from(bandSite)
		.where(eq(bandSite.groupId, bandId))
		.limit(1);

	if (!bandRow?.subscription) throw new Error('No active band subscription');

	const parsed = bandSubscriptionSchema.parse(bandRow.subscription);
	if (!parsed) throw new Error('No active band subscription');

	if (!parsed.cancelAtPeriodEnd) {
		throw new Error('Subscription is not scheduled for cancellation');
	}

	await stripe.subscriptions.update(parsed.stripeSubscriptionId, {
		cancel_at_period_end: false
	});

	const updated: BandSubscription = { ...parsed, cancelAtPeriodEnd: false };
	await db
		.update(bandSite)
		.set({
			subscription: updated as BandSubscription,
			updatedAt: new Date()
		})
		.where(eq(bandSite.groupId, bandId));
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Get parsed band subscription info. Returns null if no active subscription.
 */
export async function getBandSubscription(bandId: string): Promise<BandSubscription> {
	const [bandRow] = await db
		.select({ subscription: bandSite.subscription })
		.from(bandSite)
		.where(eq(bandSite.groupId, bandId))
		.limit(1);

	if (!bandRow) throw new Error('Band not found');

	return bandSubscriptionSchema.parse(bandRow.subscription);
}
