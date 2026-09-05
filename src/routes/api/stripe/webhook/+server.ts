import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { stripeWebhooks, webhookCryptoProvider } from '$lib/server/stripe';
import { webhookHandlerMap } from '$lib/server/finance/webhook-handlers';
import { captureException } from '$lib/server/sentry';

export const POST: RequestHandler = async ({ request }) => {
	const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
	if (!webhookSecret) {
		error(500, 'STRIPE_WEBHOOK_SECRET is not configured');
	}

	const body = await request.text();
	const signature = request.headers.get('stripe-signature');

	if (!signature) {
		error(400, 'Missing stripe-signature header');
	}

	let event;
	try {
		// Workers has no synchronous crypto — must use the async verifier with an
		// explicit SubtleCrypto provider (sync `constructEvent` throws here).
		event = await stripeWebhooks.constructEventAsync(
			body,
			signature,
			webhookSecret,
			undefined,
			webhookCryptoProvider
		);
	} catch (err) {
		// Note: this endpoint may be probed by scanners, so signature failures can be
		// somewhat noisy. Acceptable at current volume; gate or drop if it floods Sentry.
		captureException(err, { stage: 'signature_verification' });
		error(400, 'Invalid signature');
	}

	// The map pairs each event name with a handler for that event's payload, but
	// the lookup is by a runtime string, so TypeScript cannot carry the pairing
	// through. Widening to `unknown` here keeps the guarantee where it is
	// checkable — the map literal — instead of switching it off with `any`.
	const handler = webhookHandlerMap[event.type as keyof typeof webhookHandlerMap] as
		((data: unknown) => Promise<void>) | undefined;
	if (handler) {
		if (import.meta.env.DEV) {
			await handler(event.data.object);
		} else {
			try {
				await handler(event.data.object);
			} catch (err) {
				const customerId = (event.data.object as { customer?: unknown })?.customer;
				captureException(err, {
					stage: 'handler',
					eventType: event.type,
					eventId: event.id,
					customerId: typeof customerId === 'string' ? customerId : undefined
				});
				// All handlers are idempotent, so it is safe to signal failure and let
				// Stripe re-deliver (with backoff) rather than silently dropping the work.
				error(500, 'Webhook handler failed');
			}
		}
	}

	return json({ received: true });
};
