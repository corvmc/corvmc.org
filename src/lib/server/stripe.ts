import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
	if (!_stripe) {
		if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
		/**
		 * Pinned to the version this SDK's types were generated from.
		 *
		 * Unpinned, the client follows the *account's* default, which Stripe rolls
		 * forward on its own schedule — so the request version could move without a
		 * commit, while the types the code compiles against would not. They happen
		 * to agree today, and the `recordCashPayment` fault found alongside this was
		 * a payload wrong on every version rather than a drift, so this fixes no
		 * live bug. It closes the gap that would let the next roll be discovered in
		 * production instead of in CI.
		 *
		 * The literal is the SDK's own `ApiVersion`, which is a single-value type.
		 * Upgrading `stripe` therefore fails `pnpm check` here until the pin is
		 * updated deliberately — which is the point.
		 */
		_stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });
	}
	return _stripe;
}

/**
 * Crypto provider for webhook signature verification. Cloudflare Workers has no
 * synchronous crypto, so the sync `constructEvent` throws "SubtleCryptoProvider
 * cannot be used in a synchronous context." Pair this with `constructEventAsync`.
 */
export const webhookCryptoProvider = Stripe.createSubtleCryptoProvider();

/** Convenience re-export for existing call sites. */
export const stripe = new Proxy({} as Stripe, {
	get(_, prop) {
		return (getStripe() as unknown as Record<string | symbol, unknown>)[prop];
	}
});
