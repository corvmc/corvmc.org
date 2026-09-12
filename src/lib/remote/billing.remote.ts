import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { requireMember } from '$lib/server/authorization';
import { paymentDriver, stripe } from '$lib/server/stripe';
import {
	createSetupIntent,
	listCards,
	listInvoices,
	removeCard,
	rememberCard,
	setDefaultCard
} from '$lib/server/finance/billing-service';
import { completeFakeSetupIntent } from '$lib/server/finance/gateway/fake-gateway';
import { mapDomainError } from '$lib/server/errors';
import { captureException } from '$lib/server/sentry';
import { requireGroupRole } from '$lib/server/group/group-context';
import { db } from '$lib/server/db';
import { bandSite } from '$lib/server/db/schema/band-site';
import { eq } from 'drizzle-orm';

/**
 * The card on file and the invoice history — what the billing portal alone
 * reached. Its own query rather than a slice of `getMemberMembership`, because
 * everything here is a live Stripe call: the portal link this replaces sat
 * inside that page's `Promise.all`, so an outage took `/member/membership` down
 * for every sustaining member. Separate, only this section degrades.
 */
function requireStripeId(user: { stripeId: string | null }): string {
	if (!user.stripeId) error(400, 'No billing account found. Please contact support.');
	return user.stripeId;
}

export const getBilling = query(async () => {
	const user = await requireMember();
	const driver = paymentDriver();

	if (!user.stripeId) {
		return { available: true as const, driver, cards: [], invoices: [] };
	}

	try {
		const [cards, invoices] = await Promise.all([
			listCards(user.stripeId),
			listInvoices(user.stripeId)
		]);
		return { available: true as const, driver, cards, invoices };
	} catch (err) {
		// A seeded member carries a placeholder `cus_seed_…` that does not exist
		// in Stripe, and a real outage looks the same from here. Either way this
		// section says so rather than throwing the page away.
		captureException(err);
		return { available: false as const, driver, cards: [], invoices: [] };
	}
});

/**
 * Begin adding a card. Returns what the browser needs to confirm it, and which
 * driver is live — the page mounts a Setup Element under `stripe` and the
 * fake's card-number form under `fake`, the same split `/checkout/[id]` makes.
 */
export const startAddCard = command(async () => {
	const user = await requireMember();
	const stripeId = requireStripeId(user);

	const clientSecret = await createSetupIntent(stripeId);
	return { clientSecret, driver: paymentDriver() };
});

/**
 * Finish adding a card, after the browser has confirmed the SetupIntent.
 *
 * The id comes from the client, so the intent is re-read from Stripe rather
 * than trusted: what matters is the customer it was created against, which only
 * Stripe can answer. An intent belonging to someone else is refused here.
 */
export const finishAddCard = command(
	z.object({ setupIntentId: z.string().min(1) }),
	async (data) => {
		const user = await requireMember();
		const stripeId = requireStripeId(user);

		const intent = await stripe.setupIntents.retrieve(data.setupIntentId);
		const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
		if (owner !== stripeId) error(403, 'That setup does not belong to this account.');

		const methodId =
			typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
		if (intent.status !== 'succeeded' || !methodId) {
			error(400, 'That card was not confirmed. Please try again.');
		}

		try {
			await rememberCard(user.id, stripeId, methodId);
		} catch (err) {
			mapDomainError(err);
		}

		await getBilling().refresh();
	}
);

/**
 * The fake driver's half of confirming a card.
 *
 * `stripe.confirmSetup()` runs in the browser against Stripe.js, which the fake
 * has nothing to stand in for — so under `fake` the modal posts a card number
 * here instead and the attachment happens server-side. Guarded on the driver:
 * under `stripe` this route does not exist.
 */
export const payFakeSetupIntent = form(
	z.object({
		setupIntentId: z.string().min(1),
		cardNumber: z.string().min(1)
	}),
	async (data) => {
		if (paymentDriver() !== 'fake') error(404, 'Not found');

		const user = await requireMember();
		const stripeId = requireStripeId(user);

		const intent = await stripe.setupIntents.retrieve(data.setupIntentId);
		const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
		if (owner !== stripeId) error(403, 'That setup does not belong to this account.');

		const method = completeFakeSetupIntent(data.setupIntentId, data.cardNumber);

		try {
			await rememberCard(user.id, stripeId, method.id);
		} catch (err) {
			mapDomainError(err);
		}

		await getBilling().refresh();
		return { success: true };
	}
);

export const makeDefaultCard = command(
	z.object({ paymentMethodId: z.string().min(1) }),
	async (data) => {
		const user = await requireMember();
		const stripeId = requireStripeId(user);

		try {
			await setDefaultCard(user.id, stripeId, data.paymentMethodId);
		} catch (err) {
			mapDomainError(err);
		}

		await getBilling().refresh();
	}
);

export const forgetCard = command(
	z.object({ paymentMethodId: z.string().min(1) }),
	async (data) => {
		const user = await requireMember();
		const stripeId = requireStripeId(user);

		try {
			await removeCard(user.id, stripeId, data.paymentMethodId);
		} catch (err) {
			mapDomainError(err);
		}

		await getBilling().refresh();
	}
);

// ---------------------------------------------------------------------------
// Band billing
// ---------------------------------------------------------------------------
//
// The member's service, resolved from `bandSite.stripeCustomerId` rather than
// `user.stripeId` and guarded as the band. `userId: null` skips the
// mirror-onto-user step: the card is the band's, which is the whole of #1098.
// ---------------------------------------------------------------------------

/** The band's customer, and the caller's right to act for it. */
async function requireBandCustomer(slug: string): Promise<string> {
	const { group: band } = await requireGroupRole({ slug }, 'admin');

	const [row] = await db
		.select({ stripeCustomerId: bandSite.stripeCustomerId })
		.from(bandSite)
		.where(eq(bandSite.groupId, band.id))
		.limit(1);

	if (!row?.stripeCustomerId) error(400, 'This act has no billing account yet.');
	return row.stripeCustomerId;
}

export const getBandBilling = query(z.string(), async (slug) => {
	const customerId = await requireBandCustomer(slug);

	try {
		return {
			available: true as const,
			driver: paymentDriver(),
			cards: await listCards(customerId)
		};
	} catch (err) {
		// Same reasoning as `getBilling`: a Stripe outage makes the card list
		// unknown, not empty, and must not take the subscription page with it.
		captureException(err);
		return { available: false as const, driver: paymentDriver(), cards: [] };
	}
});

export const startBandAddCard = command(z.string(), async (slug) => {
	const customerId = await requireBandCustomer(slug);
	return { clientSecret: await createSetupIntent(customerId), driver: paymentDriver() };
});

export const finishBandAddCard = command(
	z.object({ slug: z.string().min(1), setupIntentId: z.string().min(1) }),
	async (data) => {
		const customerId = await requireBandCustomer(data.slug);

		// Re-read rather than trusted: the id comes from the client, and what
		// matters is the customer it was created against.
		const intent = await stripe.setupIntents.retrieve(data.setupIntentId);
		const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
		if (owner !== customerId) error(403, 'That setup does not belong to this act.');

		const methodId =
			typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
		if (intent.status !== 'succeeded' || !methodId) {
			error(400, 'That card was not confirmed. Please try again.');
		}

		try {
			// Straight to default: a band has one payer, so a card added here is
			// always the one the subscription should bill.
			await rememberCard(null, customerId, methodId);
		} catch (err) {
			mapDomainError(err);
		}

		await getBandBilling(data.slug).refresh();
	}
);

export const forgetBandCard = command(
	z.object({ slug: z.string().min(1), paymentMethodId: z.string().min(1) }),
	async (data) => {
		const customerId = await requireBandCustomer(data.slug);

		try {
			await removeCard(null, customerId, data.paymentMethodId);
		} catch (err) {
			mapDomainError(err);
		}

		await getBandBilling(data.slug).refresh();
	}
);
