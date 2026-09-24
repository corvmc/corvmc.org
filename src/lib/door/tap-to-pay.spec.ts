import { describe, it, expect, vi } from 'vitest';
import {
	connectDoorReader,
	describeTapError,
	takeTap,
	tapToPayBridge,
	TAP_TO_PAY_UX,
	type TapToPayBridge
} from './tap-to-pay';

function fakeBridge(over: Partial<TapToPayBridge> = {}) {
	const listeners: Record<string, () => void> = {};
	const bridge = {
		initialize: vi.fn(async () => undefined),
		setConnectionToken: vi.fn(async () => undefined),
		addListener: vi.fn(async (event: string, fn: () => void) => {
			listeners[event] = fn;
			return { remove: async () => undefined };
		}),
		setTapToPayUxConfiguration: vi.fn(async () => undefined),
		discoverReaders: vi.fn(async () => ({ readers: [{ serialNumber: 'phone' }] })),
		connectReader: vi.fn(async () => undefined),
		getConnectedReader: vi.fn(async () => ({ reader: null })),
		collectPaymentMethod: vi.fn(async () => undefined),
		confirmPaymentIntent: vi.fn(async () => undefined),
		cancelCollectPaymentMethod: vi.fn(async () => undefined),
		...over
	} satisfies TapToPayBridge;
	return { bridge, listeners };
}

const connection = { secret: 'pst_test_1', locationId: 'tml_door', simulated: true };

describe('finding the plugin', () => {
	it('is absent in a plain browser', () => {
		expect(tapToPayBridge({})).toBeNull();
	});

	it('is the native plugin inside the Android shell', () => {
		const plugin = {};
		expect(tapToPayBridge({ Capacitor: { Plugins: { StripeTerminal: plugin } } })).toBe(plugin);
	});
});

describe('connecting the phone as the reader', () => {
	it('binds to the Location, as simulated as the key says, with the CMC tap screen', async () => {
		const { bridge } = fakeBridge();
		await connectDoorReader(bridge, async () => connection);

		expect(bridge.initialize).toHaveBeenCalledWith({ isTest: true });
		expect(bridge.setTapToPayUxConfiguration).toHaveBeenCalledWith(TAP_TO_PAY_UX);
		expect(bridge.discoverReaders).toHaveBeenCalledWith({
			type: 'tap-to-pay',
			locationId: 'tml_door'
		});
		expect(bridge.connectReader).toHaveBeenCalledWith(
			expect.objectContaining({
				reader: { serialNumber: 'phone' },
				merchantDisplayName: 'Corvallis Music Collective'
			})
		);
	});

	it('answers each token request with a fresh token, never a spent one', async () => {
		const { bridge, listeners } = fakeBridge();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(connection)
			.mockResolvedValueOnce({ ...connection, secret: 'pst_test_2' });
		await connectDoorReader(bridge, fetch);

		await listeners.terminalRequestedConnectionToken();
		await listeners.terminalRequestedConnectionToken();
		expect(vi.mocked(bridge.setConnectionToken).mock.calls).toEqual([
			[{ token: 'pst_test_1' }],
			[{ token: 'pst_test_2' }]
		]);
	});

	it('does nothing when the phone is already connected', async () => {
		const { bridge } = fakeBridge({
			getConnectedReader: vi.fn(async () => ({ reader: { serialNumber: 'phone' } }))
		});
		const fetch = vi.fn(async () => connection);
		await connectDoorReader(bridge, fetch);
		expect(fetch).not.toHaveBeenCalled();
		expect(bridge.connectReader).not.toHaveBeenCalled();
	});

	it('says so when the phone cannot be a reader', async () => {
		const { bridge } = fakeBridge({ discoverReaders: vi.fn(async () => ({ readers: [] })) });
		await expect(connectDoorReader(bridge, async () => connection)).rejects.toThrow(
			/cannot act as a card reader/
		);
	});
});

describe('the tap', () => {
	it('collects, then confirms, the intent the server made', async () => {
		const { bridge } = fakeBridge();
		await takeTap(bridge, 'pi_1_secret_x');
		expect(bridge.collectPaymentMethod).toHaveBeenCalledWith({ paymentIntent: 'pi_1_secret_x' });
		expect(bridge.confirmPaymentIntent).toHaveBeenCalled();
	});
});

describe('what the staffer is told', () => {
	it("names an insecure phone as the phone's problem, never the card's", () => {
		const message = describeTapError(
			new Error('TAP_TO_PAY_INSECURE_ENVIRONMENT: developer options')
		);
		expect(message).toMatch(/this phone/i);
		expect(message).not.toMatch(/declined/i);
	});

	it('treats a cancel as a cancel', () => {
		expect(describeTapError(new Error('The command was canceled.'))).toMatch(/cancelled/i);
	});

	it('offers the other path on anything else', () => {
		expect(describeTapError(new Error('Card read failed'))).toMatch(/own phone/);
	});
});
