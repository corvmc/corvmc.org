import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { createStripeGateway } from '$lib/server/finance/gateway/stripe-gateway';
import { createFakeGateway } from '$lib/server/finance/gateway/fake-gateway';
import type { PaymentDriver, PaymentGateway } from '$lib/server/finance/gateway/types';

let _gateway: PaymentGateway | null = null;

/**
 * `stripe` unless the environment explicitly asks for it.
 *
 * The default is the safe one on purpose. A developer checkout of this project
 * carries a live restricted key in `.env`, so a driver that defaulted to
 * `stripe` would let a mistyped QA step move real money. Production opts in
 * through `wrangler.toml`; everything else — `pnpm dev`, e2e, specs — gets the
 * in-memory fake.
 */
export function paymentDriver(): PaymentDriver {
	return env.PAYMENTS_DRIVER === 'stripe' ? 'stripe' : 'fake';
}

function getGateway(): PaymentGateway {
	if (!_gateway) {
		_gateway = paymentDriver() === 'stripe' ? createStripeGateway() : createFakeGateway();
	}
	return _gateway;
}

/**
 * Override the gateway. For specs that want to drive the fake directly; the
 * running app resolves its own driver and never calls this.
 */
export function initStripe(gateway: PaymentGateway | null): void {
	_gateway = gateway;
}

/**
 * Webhook signature verification, always against the real SDK.
 *
 * This is the production ingress and a security boundary, so it does not follow
 * the driver — verifying a signature is a pure function of the payload and the
 * secret, and `Stripe.webhooks` is a static that needs no API key. The fake
 * checkout page reaches fulfillment by calling `handleCheckoutCompleted`
 * directly rather than by forging a signed request, which leaves this path with
 * exactly one caller in every environment.
 */
export const stripeWebhooks = Stripe.webhooks;

/**
 * Crypto provider for webhook signature verification. Cloudflare Workers has no
 * synchronous crypto, so the sync `constructEvent` throws "SubtleCryptoProvider
 * cannot be used in a synchronous context." Pair this with `constructEventAsync`.
 */
export const webhookCryptoProvider = Stripe.createSubtleCryptoProvider();

/**
 * The gateway, as a lazy proxy so importing this module never reads env or
 * constructs a client at module scope.
 */
export const stripe = new Proxy({} as PaymentGateway, {
	get(_, prop) {
		return (getGateway() as unknown as Record<string | symbol, unknown>)[prop];
	}
});
