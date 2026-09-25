/**
 * The door phone's reader, driven from the web page (#612).
 *
 * The Android shell loads corvmc.org itself, and Capacitor's bridge exposes
 * every native plugin on `window.Capacitor.Plugins`. So the site reaches
 * `@capgo/capacitor-stripe-terminal` without depending on it: in a plain
 * browser there is no bridge and the door screen offers the other path.
 */

/** The slice of the plugin the door calls. Names match its 8.x definitions. */
export interface TapToPayBridge {
	initialize(options: { isTest: boolean }): Promise<void>;
	setConnectionToken(options: { token: string }): Promise<void>;
	addListener(event: string, listener: () => void): Promise<{ remove(): Promise<void> }>;
	setTapToPayUxConfiguration(options: typeof TAP_TO_PAY_UX): Promise<void>;
	discoverReaders(options: { type: 'tap-to-pay'; locationId: string }): Promise<{
		readers: unknown[];
	}>;
	connectReader(options: {
		reader: unknown;
		autoReconnectOnUnexpectedDisconnect?: boolean;
		merchantDisplayName?: string;
	}): Promise<void>;
	getConnectedReader(): Promise<{ reader: unknown | null }>;
	collectPaymentMethod(options: { paymentIntent: string }): Promise<void>;
	confirmPaymentIntent(): Promise<void>;
	cancelCollectPaymentMethod(): Promise<void>;
}

export interface TerminalConnection {
	secret: string;
	locationId: string;
	simulated: boolean;
}

type CapacitorWindow = { Capacitor?: { Plugins?: { StripeTerminal?: unknown } } };

export function tapToPayBridge(win: CapacitorWindow = globalThis as CapacitorWindow) {
	return (win.Capacitor?.Plugins?.StripeTerminal as TapToPayBridge | undefined) ?? null;
}

/** The only screen the customer sees: the CMC palette, flat colors, no gradients. */
export const TAP_TO_PAY_UX = {
	colors: { primary: '#e5771e', success: '#2e7d32', error: '#c62828' },
	darkMode: 'SYSTEM'
} as const;

let tokenListener: { remove(): Promise<void> } | null = null;

/**
 * Connect the phone's own NFC as the reader, bound to the Location.
 *
 * Tokens are single-use, so the first one fetched answers the SDK's first
 * request and every later request fetches another.
 */
export async function connectDoorReader(
	bridge: TapToPayBridge,
	fetchConnection: () => Promise<TerminalConnection>
): Promise<void> {
	if ((await bridge.getConnectedReader()).reader) return;

	const first = await fetchConnection();
	let unspent: string | null = first.secret;
	await tokenListener?.remove();
	tokenListener = await bridge.addListener('terminalRequestedConnectionToken', async () => {
		const token = unspent ?? (await fetchConnection()).secret;
		unspent = null;
		await bridge.setConnectionToken({ token });
	});

	await bridge.initialize({ isTest: first.simulated });
	await bridge.setTapToPayUxConfiguration(TAP_TO_PAY_UX);
	const { readers } = await bridge.discoverReaders({
		type: 'tap-to-pay',
		locationId: first.locationId
	});
	if (readers.length === 0) {
		throw new Error('This phone cannot act as a card reader. Check it against the door checklist.');
	}
	await bridge.connectReader({
		reader: readers[0],
		autoReconnectOnUnexpectedDisconnect: true,
		merchantDisplayName: 'Corvallis Music Collective'
	});
}

/** Hand the phone to the customer. Resolves once the SDK has confirmed the intent. */
export async function takeTap(bridge: TapToPayBridge, clientSecret: string): Promise<void> {
	await bridge.collectPaymentMethod({ paymentIntent: clientSecret });
	await bridge.confirmPaymentIntent();
}

/**
 * What the staffer reads when a tap fails. An insecure phone or an unreadable
 * card is never the customer's decline, and saying so is the whole point.
 */
export function describeTapError(err: unknown): string {
	const text = err instanceof Error ? err.message : String(err);
	if (text.includes('TAP_TO_PAY_INSECURE_ENVIRONMENT')) {
		return (
			'This phone is in a state that cannot take a PIN: Developer options, screen recording, ' +
			'an overlay or an accessibility service is on. It is not their card. Have them pay on ' +
			'their own phone instead.'
		);
	}
	if (/cancel/i.test(text)) return 'Tap cancelled. Nothing was charged.';
	return `The tap did not go through (${text}). Try again, or have them pay on their own phone.`;
}
