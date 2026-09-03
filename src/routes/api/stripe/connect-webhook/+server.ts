import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { stripe, webhookCryptoProvider } from '$lib/server/stripe';
import { syncAccountFromStripe } from '$lib/server/audio/connect-service';
import { captureException } from '$lib/server/sentry';

/**
 * Stripe **Connect** events — a second endpoint, not a second handler on the
 * existing one.
 *
 * Connect events describe connected accounts rather than the platform's own
 * activity, and Stripe delivers them to endpoints registered with
 * `connect: true`. Those carry **their own signing secret**: verifying one
 * against `STRIPE_WEBHOOK_SECRET` fails every time. That failure is silent in
 * the way that matters — nothing errors visibly, band accounts simply never flip
 * to `chargesEnabled` and nobody can sell — so the two secrets are kept in two
 * routes where confusing them is impossible.
 *
 * Only `account.updated` is handled. Everything else is acknowledged, because a
 * 4xx makes Stripe retry an event we were never going to act on.
 */
export const POST: RequestHandler = async ({ request }) => {
	const webhookSecret = env.STRIPE_CONNECT_WEBHOOK_SECRET;
	if (!webhookSecret) {
		error(500, 'STRIPE_CONNECT_WEBHOOK_SECRET is not configured');
	}

	const body = await request.text();
	const signature = request.headers.get('stripe-signature');
	if (!signature) error(400, 'Missing stripe-signature header');

	let event;
	try {
		// Workers has no synchronous crypto — the sync `constructEvent` throws
		// here, so this needs the async verifier and an explicit provider.
		event = await stripe.webhooks.constructEventAsync(
			body,
			signature,
			webhookSecret,
			undefined,
			webhookCryptoProvider
		);
	} catch (err) {
		captureException(err, { stage: 'connect_signature_verification' });
		error(400, 'Invalid signature');
	}

	if (event.type !== 'account.updated') return json({ received: true, handled: false });

	try {
		const known = await syncAccountFromStripe(event.data.object);
		// An account the platform holds but this feature did not create is not an
		// error — returning one would make Stripe retry it forever.
		return json({ received: true, handled: known });
	} catch (err) {
		captureException(err, {
			stage: 'connect_handler',
			eventType: event.type,
			eventId: event.id,
			account: event.account
		});
		// The sync is idempotent, so failing loudly and letting Stripe re-deliver
		// is better than dropping the update and leaving the row stale forever.
		error(500, 'Connect webhook handler failed');
	}
};
