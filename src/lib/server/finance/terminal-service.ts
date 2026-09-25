import { env } from '$env/dynamic/private';
import { paymentDriver, stripe } from '$lib/server/stripe';
import { DomainError } from '$lib/server/domain-error';
import { FAKE_TERMINAL_LOCATION_ID } from './gateway/fake-gateway';

/** No Stripe Location is configured, so the door phone has nowhere to bind. */
export class TerminalNotConfiguredError extends DomainError {
	readonly httpStatus = 503;

	constructor() {
		super('Card payments at the door are not set up yet');
	}
}

/**
 * The Location the door phone binds to at `connectReader`.
 *
 * The fake driver always answers with its own, so a real `tml_` id in a dev
 * `.env` can never be paired with the in-memory gateway, or the reverse.
 */
export function terminalLocationId(): string | null {
	if (paymentDriver() === 'fake') return FAKE_TERMINAL_LOCATION_ID;
	return env.STRIPE_TERMINAL_LOCATION_ID || null;
}

/** A simulated reader works only in test mode, and a real tap only on a live key. */
function isLiveKey(): boolean {
	const key = env.STRIPE_SECRET_KEY ?? '';
	return paymentDriver() === 'stripe' && /^(sk|rk)_live_/.test(key);
}

export interface TerminalConnection {
	/** Short-lived and single-use: handed straight to `setConnectionToken`, never stored. */
	secret: string;
	locationId: string;
	/** Passed to the plugin as `isTest`, which Tap to Pay discovery reads as simulated. */
	simulated: boolean;
}

/** Mint a connection token scoped to the Location. Never unscoped. */
export async function mintConnectionToken(): Promise<TerminalConnection> {
	const locationId = terminalLocationId();
	if (!locationId) throw new TerminalNotConfiguredError();
	const token = await stripe.terminal.connectionTokens.create({ location: locationId });
	return { secret: token.secret, locationId, simulated: !isLiveKey() };
}
