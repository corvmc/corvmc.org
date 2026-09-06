import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import type { PaymentGateway } from './types';

let _stripe: Stripe | null = null;

/**
 * The live gateway: a real Stripe client, which structurally satisfies
 * `PaymentGateway` because the port is `Pick`ed off Stripe's own types.
 */
export function createStripeGateway(): PaymentGateway {
	if (!_stripe) {
		if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
		/**
		 * Pinned to the version this SDK's types were generated from.
		 *
		 * Unpinned, the client follows the *account's* default, which Stripe rolls
		 * forward on its own schedule — so the request version could move without a
		 * commit, while the types the code compiles against would not.
		 *
		 * The literal is the SDK's own `ApiVersion`, which is a single-value type.
		 * Upgrading `stripe` therefore fails `pnpm check` here until the pin is
		 * updated deliberately — which is the point, and which is also what keeps
		 * the fake's committed fixtures honest.
		 */
		_stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-08-26.dahlia' });
	}
	return _stripe;
}
