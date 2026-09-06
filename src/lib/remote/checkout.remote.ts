import { z } from 'zod';
import { error, invalid, redirect } from '@sveltejs/kit';
import { form, query } from '$app/server';
import { paymentDriver, stripe } from '$lib/server/stripe';
import {
	FAKE_CARDS,
	completeFakeCheckout,
	getFakeSession,
	outcomeForCard
} from '$lib/server/finance/gateway/fake-gateway';
import { handleCheckoutCompleted } from '$lib/server/finance/webhook-handlers';

/**
 * The in-app checkout page's data, for both drivers.
 *
 * Under `stripe` this is an `ui_mode: 'elements'` session and the page mounts a
 * Payment Element against the client secret. Under `fake` it is an in-memory
 * session and the page renders a card-number form instead — same route, same
 * totals, same destination, so nothing above this layer knows which one ran.
 *
 * Deliberately unauthenticated: guest ticket checkout has no session, and the
 * only thing a caller can do is complete a checkout session id it already
 * holds — which is the same capability the real Stripe URL confers.
 */
function requireFakeDriver(): void {
	if (paymentDriver() !== 'fake') error(404, 'Not found');
}

export const getCheckoutSession = query(z.string().min(1), async (sessionId) => {
	const driver = paymentDriver();

	// The fake keeps its sessions in the isolate rather than behind an API call,
	// so each driver is read the way it is cheapest to read. Both signal a bad id
	// as a 404 here — the real one raises rather than returning nothing, and an
	// unknown session is a wrong URL, not a server fault.
	const session = await (driver === 'fake'
		? Promise.resolve(getFakeSession(sessionId))
		: stripe.checkout.sessions.retrieve(sessionId).catch(() => undefined));
	if (!session) error(404, 'No such checkout session');

	return {
		id: session.id,
		driver,
		mode: session.mode,
		status: session.status,
		amountSubtotal: session.amount_subtotal ?? 0,
		amountTotal: session.amount_total ?? 0,
		currency: session.currency ?? 'usd',
		customerEmail: session.customer_email,
		/** Only set on an `elements` session; the fake mints one regardless. */
		clientSecret: driver === 'stripe' ? session.client_secret : null,
		/** Surfaced so a test can assert on what the app attached without expanding the session. */
		metadata: session.metadata ?? {},
		// An `elements` session has no `cancel_url` field — Stripe rejects one —
		// so `checkout()` stashes the destination in metadata instead.
		cancelUrl: session.cancel_url ?? session.metadata?.cancel_url ?? null,
		testCards:
			driver === 'fake'
				? Object.entries(FAKE_CARDS).map(([number, outcome]) => ({ number, outcome }))
				: []
	};
});

export const payFakeCheckout = form(
	z.object({
		sessionId: z.string().min(1),
		cardNumber: z.string().min(1)
	}),
	async (data, issue) => {
		requireFakeDriver();

		const session = getFakeSession(data.sessionId);
		if (!session) error(404, 'No such checkout session');

		// Stripe's own decline copy, so a test asserting on the message keeps
		// asserting the same thing once the real Payment Element is behind this.
		const outcome = outcomeForCard(data.cardNumber);
		const declineMessage =
			outcome === undefined
				? 'Use one of the test cards listed below.'
				: outcome === 'decline'
					? 'Your card has been declined.'
					: outcome === 'insufficient_funds'
						? 'Your card has insufficient funds.'
						: null;
		if (declineMessage) invalid(issue.cardNumber(declineMessage));

		// Fulfillment goes through the production translation layer, not around
		// it: the fake mints the session, and the same handler the Stripe webhook
		// calls turns it into domain events. A path the fake alone could reach
		// would be a path no test actually covers.
		const completed = completeFakeCheckout(data.sessionId);
		await handleCheckoutCompleted(completed);

		const destination = completed.return_url ?? completed.success_url;
		if (destination) redirect(303, destination);
		return { success: true };
	}
);
