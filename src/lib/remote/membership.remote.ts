import { z } from 'zod';
import { redirect, error } from '@sveltejs/kit';
import { form, getRequestEvent, query } from '$app/server';
import { requireMember } from '$lib/server/authorization';
import {
	createCheckoutSession,
	getMemberSubscription,
	mapDbSubscription,
	patchMemberSubscription,
	createBillingPortalUrl,
	updateQuantity,
	resume
} from '$lib/server/finance/subscription-service';
import { getAllBalances, getUsageSinceLastAllocation } from '$lib/server/finance/credit-service';
import { getCommunityStats } from '$lib/server/finance/community-stats';
import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
import { getProductConfig } from '$lib/server/finance/product-config-service';
import { ensureStripeCustomer } from '$lib/server/finance/stripe-customer-service';
import { mapDomainError } from '$lib/server/errors';
import { captureException } from '$lib/server/sentry';
import { DOLLARS_PER_UNIT } from '$lib/config';

/**
 * The billing portal link, or null if Stripe cannot produce one.
 *
 * It used to sit unguarded in the `Promise.all` below, which made a convenience
 * link load-bearing for the whole page: a Stripe outage, or a customer deleted
 * from the Stripe dashboard, took `/member/membership` down for every
 * sustaining member instead of hiding one button. The subscription, credits and
 * allocation rendered beside it are the page; this is the button.
 *
 * It is also what made sustaining members unseedable. `scripts/seed/users.ts`
 * writes a placeholder `cus_seed_…` customer, which is not falsy, so the old
 * short-circuit did not catch it and every seeded sustaining member hit a
 * customer that does not exist.
 */
async function billingPortalUrlOrNull(
	stripeId: string | null,
	returnUrl: string
): Promise<string | null> {
	if (!stripeId) return null;
	try {
		return await createBillingPortalUrl(stripeId, returnUrl);
	} catch (err) {
		captureException(err);
		return null;
	}
}

export const getMemberMembership = query(async () => {
	const user = await requireMember();
	const { url } = getRequestEvent();

	const [dbSubscription, credits, communityStats, contributionConfig, billingPortalUrl] =
		await Promise.all([
			getMemberSubscription(user.id),
			getAllBalances(user.id),
			getCommunityStats(),
			getProductConfig('contribution'),
			billingPortalUrlOrNull(user.stripeId, `${url.origin}/member/membership`)
		]);

	const subscription = mapDbSubscription(dbSubscription);

	// Allocation/usage are tracked in credits (30-min blocks); the UI converts to
	// hours for display via creditsToHours. Usage comes from the ledger so a
	// mid-cycle contribution change (which bumps hoursPerReset before the next
	// invoice re-allocates) doesn't distort it; fall back to the balance
	// shortcut when no allocation has ever run.
	const allocatedThisMonth = dbSubscription?.hoursPerReset ?? 0;
	const ledgerUsage = await getUsageSinceLastAllocation(user.id, 'free_hours');
	const usedThisMonth = ledgerUsage ?? Math.max(0, allocatedThisMonth - (credits.free_hours ?? 0));

	return {
		subscription,
		credits,
		billingPortalUrl,
		communityStats,
		allocatedThisMonth,
		usedThisMonth,
		contributionUnitCents: contributionConfig.unitAmountCents,
		feeSchedule: {
			perUnit: calculateTotalWithFeeCoverage(contributionConfig.unitAmountCents).feeCents
		}
	};
});

const MIN_QUANTITY = 2;

function requireStripeId(user: { stripeId: string | null }) {
	if (!user.stripeId) throw error(400, 'No billing account found. Please contact support.');
	return user.stripeId;
}

const amountSchema = z
	.object({
		amount: z
			.string()
			.transform(Number)
			.refine(
				(n) => !isNaN(n) && n >= MIN_QUANTITY * DOLLARS_PER_UNIT,
				`Contribution must be at least $${MIN_QUANTITY * DOLLARS_PER_UNIT}/month`
			),
		coverFees: z.boolean().default(false)
	})
	.refine((d) => d.amount % DOLLARS_PER_UNIT === 0, {
		message: `Contribution must be a multiple of $${DOLLARS_PER_UNIT}`,
		path: ['amount']
	});

export const createSubscription = form(amountSchema, async (data) => {
	const user = await requireMember();

	// Server-side duplicate guard: a stale tab or double submit must not create
	// a second live Stripe subscription (mirrors the band premium flow).
	if (await getMemberSubscription(user.id)) {
		throw error(400, 'You already have an active membership — update your contribution instead.');
	}

	// A brand-new member legitimately has no Stripe customer yet — create it on
	// demand (returns the existing id when present) rather than failing.
	const stripeId = await ensureStripeCustomer(user.id, user.email, user.name);
	const { url } = getRequestEvent();

	const checkoutUrl = await createCheckoutSession({
		userId: user.id,
		stripeCustomerId: stripeId,
		quantity: data.amount / DOLLARS_PER_UNIT,
		coverFees: data.coverFees,
		// The two used to be the same URL, which made a cancel indistinguishable
		// from a success. `elements` has no cancel redirect at all, so that bug is
		// gone either way — but the cancel destination is now the page's "Cancel
		// and go back" link, and `?subscribed` is what tells the page to wait for
		// the webhook rather than declare the member a non-member.
		successUrl: `${url.origin}/member/membership?subscribed=1`,
		cancelUrl: `${url.origin}/member/membership`
	});

	// Relative now — `elements` returns the in-app `/checkout/<session>`, so this
	// is a client-side navigation rather than a document load off to Stripe.
	redirect(303, checkoutUrl);
});

export const updateAmount = form(amountSchema, async (data) => {
	const user = await requireMember();
	const stripeId = requireStripeId(user);

	const units = data.amount / DOLLARS_PER_UNIT;
	try {
		await updateQuantity(stripeId, units, data.coverFees);
	} catch (err) {
		mapDomainError(err);
	}
	// Write-through so the page reflects the change before the webhook lands.
	// hoursPerReset is in credits (30-min blocks): units × 2.
	await patchMemberSubscription(user.id, {
		hoursPerReset: units * 2,
		coveringFees: data.coverFees
	});
	return { success: true };
});

// A form with no fields of its own. `z.object({})` no longer resolves against
// kit's schema overload, and there is nothing here to validate anyway — the
// guard on the first line of the handler is the whole check.
export const resumeSubscription = form('unchecked', async () => {
	const user = await requireMember();
	const stripeId = requireStripeId(user);

	try {
		await resume(stripeId);
	} catch (err) {
		mapDomainError(err);
	}
	await patchMemberSubscription(user.id, { cancelAtPeriodEnd: false });
	return { success: true };
});
