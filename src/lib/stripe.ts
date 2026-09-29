import { env } from '$env/dynamic/public';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { reportError } from '$lib/report-error';

/**
 * Publishable key for Stripe.js on the client.
 *
 * Empty wherever the `fake` driver is active — the checkout page asks the
 * server which driver is live and renders the fake form, so Stripe.js never
 * loads. Turnstile's "test key that always works" has no Stripe equivalent, so
 * empty is the honest value rather than a placeholder that fails later.
 */
export const STRIPE_PUBLISHABLE_KEY = env.PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

export const PAYMENTS_UNAVAILABLE =
	"Payments are unavailable right now. We've been notified — please try again later.";

/**
 * Stripe.js, or null after reporting why not. A payment surface only mounts
 * under the `stripe` driver, so a missing key or a failed load here is always a
 * misconfiguration or an outage staff need to hear about, never a user error.
 */
export async function loadStripeOrReport(surface: string): Promise<Stripe | null> {
	if (!STRIPE_PUBLISHABLE_KEY) {
		reportError(new Error('PUBLIC_STRIPE_PUBLISHABLE_KEY is not set'), { surface });
		return null;
	}
	const stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY);
	if (!stripe) reportError(new Error('Stripe.js failed to load'), { surface });
	return stripe;
}
