import * as env from '$app/env/public';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { reportError } from '#lib/report-error.js';

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

/** How long a Stripe confirm may run before the buyer is told to check for a charge. */
export const STRIPE_CONFIRM_DEADLINE_MS = 60_000;

export const STRIPE_CONFIRM_TIMED_OUT = 'timed_out' as const;

/**
 * `confirm` with a deadline. Stripe's confirm can wait on an invisible hCaptcha
 * challenge that never finishes in some browsers (#2862), and its promise then
 * never settles. Past the deadline this resolves `'timed_out'` and reports it;
 * the original promise is left running, so a late success still redirects.
 */
export async function withStripeDeadline<T>(
	confirm: Promise<T>,
	surface: string,
	ms: number = STRIPE_CONFIRM_DEADLINE_MS
): Promise<T | typeof STRIPE_CONFIRM_TIMED_OUT> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof STRIPE_CONFIRM_TIMED_OUT>((resolve) => {
		timer = setTimeout(() => resolve(STRIPE_CONFIRM_TIMED_OUT), ms);
	});
	try {
		const result = await Promise.race([confirm, deadline]);
		if (result === STRIPE_CONFIRM_TIMED_OUT) {
			reportError(new Error('Stripe confirm did not settle'), {
				surface,
				ms,
				userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent
			});
		}
		return result;
	} finally {
		clearTimeout(timer);
	}
}
