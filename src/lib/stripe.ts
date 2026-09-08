import { env } from '$env/dynamic/public';

/**
 * Publishable key for Stripe.js on the client.
 *
 * Empty wherever the `fake` driver is active — the checkout page asks the
 * server which driver is live and renders the fake form, so Stripe.js never
 * loads. Turnstile's "test key that always works" has no Stripe equivalent, so
 * empty is the honest value rather than a placeholder that fails later.
 */
export const STRIPE_PUBLISHABLE_KEY = env.PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
