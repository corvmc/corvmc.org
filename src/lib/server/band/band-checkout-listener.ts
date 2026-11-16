import type Stripe from 'stripe';
import { syncFromWebhook } from './band-subscription-service';
import { stripe } from '#lib/server/stripe.js';

/**
 * Handles checkout.session.completed for band_premium subscriptions.
 *
 * When a band owner completes checkout, Stripe creates the subscription.
 * We fetch it here and sync the band's tier + subscription JSON.
 */
export async function handleBandPremiumCheckout(session: Stripe.Checkout.Session): Promise<void> {
	const metadata = session.metadata ?? {};

	if (metadata.subscription_type !== 'band_premium') return;
	if (!metadata.band_id) {
		console.warn('band_premium checkout missing band_id in metadata');
		return;
	}

	const subscriptionId =
		typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

	if (!subscriptionId) {
		console.warn('band_premium checkout missing subscription ID');
		return;
	}

	const subscription = await stripe.subscriptions.retrieve(subscriptionId);

	// Ensure the subscription carries the band metadata for future webhook events
	if (!subscription.metadata?.band_id) {
		await stripe.subscriptions.update(subscriptionId, {
			metadata: {
				subscription_type: 'band_premium',
				band_id: metadata.band_id
			}
		});
	}

	await syncFromWebhook(metadata.band_id, subscription);
}
