import Stripe from 'stripe';
import * as env from '$app/env/private';
import {
	impersonatorId,
	refuseWhileImpersonating
} from '#lib/server/impersonation/impersonation-guard.js';
import { createStripeGateway } from '#lib/server/finance/gateway/stripe-gateway.js';
import { createFakeGateway } from '#lib/server/finance/gateway/fake-gateway.js';
import type { PaymentDriver, PaymentGateway } from '#lib/server/finance/gateway/types.js';

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
		const value = (getGateway() as unknown as Record<string | symbol, unknown>)[prop];
		return impersonatorId() && value && typeof value === 'object' ? readOnly(value) : value;
	}
});

const READS = new Set(['retrieve', 'list']);

/**
 * The gateway as an admin viewing as a member sees it (#2847): reads pass, and
 * every call that could move money or change the member's billing is refused.
 * Money moved on someone else's card is the one thing acting as them must not do.
 */
function readOnly(resource: object): unknown {
	return new Proxy(resource, {
		get(target, prop) {
			const value: unknown = Reflect.get(target, prop);
			if (typeof value === 'function') {
				if (READS.has(String(prop))) return value.bind(target);
				return () => {
					refuseWhileImpersonating();
					throw new Error(`Payment gateway ${String(prop)} refused while viewing as a member`);
				};
			}
			return value && typeof value === 'object' ? readOnly(value) : value;
		}
	});
}
