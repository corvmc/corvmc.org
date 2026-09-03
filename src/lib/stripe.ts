import { env } from '$env/dynamic/public';

/**
 * Publishable key for Stripe.js on the client.
 *
 * Empty everywhere the `fake` payments driver is active — `pnpm dev`, e2e and
 * the specs never load Stripe.js at all, because the checkout page asks the
 * server which driver is live and renders the fake form instead. There is no
 * "test key that always works" to fall back on the way Turnstile has one, so an
 * empty string here is the honest value rather than a placeholder that would
 * fail at `loadStripe` with a less obvious message.
 */
export const STRIPE_PUBLISHABLE_KEY = env.PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
