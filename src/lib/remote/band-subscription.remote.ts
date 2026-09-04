import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import {
	getBandSubscription,
	createBandPremiumCheckout,
	cancelBandSubscription,
	resumeBandSubscription,
	getBandPremiumPricing
} from '$lib/server/band/band-subscription-service';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getBandSubscriptionInfo = query(z.string(), async (slug) => {
	// Was `requireUser()` and nothing else, which served any band's tier and its
	// whole Stripe subscription record to any signed-in account that knew a slug.
	// Membership, not ownership: the page renders read-only for a non-owner
	// member today and this is not the change that takes that away.
	const { group: band } = await requireGroupRole({ slug }, 'member', { allowStaff: true });

	const [subscription, pricing] = await Promise.all([
		getBandSubscription(band.id),
		// Sent with the rest rather than fetched by the page: the upsell has to
		// quote the same number checkout will charge.
		getBandPremiumPricing()
	]);

	return {
		tier: band.tier,
		subscription,
		pricing
	};
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const upgradeToPremium = form(
	z.object({
		slug: z.string().min(1),
		billingInterval: z.enum(['monthly', 'yearly'])
	}),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ slug: data.slug }, 'owner');

		if (band.tier === 'premium') {
			throw error(400, 'Band already has premium tier');
		}

		if (!user.stripeId) {
			throw error(
				400,
				'Payment method required. Please set up billing in your membership settings first.'
			);
		}

		const { url } = getRequestEvent();
		const checkoutUrl = await createBandPremiumCheckout({
			bandId: band.id,
			stripeCustomerId: user.stripeId,
			billingInterval: data.billingInterval,
			successUrl: `${url.origin}/band/${band.slug}/subscription?success=true`,
			cancelUrl: `${url.origin}/band/${band.slug}/subscription`
		});

		return { redirectUrl: checkoutUrl };
	}
);

export const cancelPremium = form(z.object({ slug: z.string().min(1) }), async (data) => {
	const { group: band } = await requireGroupRole({ slug: data.slug }, 'owner');
	await cancelBandSubscription(band.id);
	return { success: true };
});

export const resumePremium = form(z.object({ slug: z.string().min(1) }), async (data) => {
	const { group: band } = await requireGroupRole({ slug: data.slug }, 'owner');
	await resumeBandSubscription(band.id);
	return { success: true };
});
