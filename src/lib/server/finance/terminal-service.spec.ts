import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { initStripe } = await import('$lib/server/stripe');
const { createFakeGateway, resetFakeGateway, FAKE_TERMINAL_LOCATION_ID, FAKE_TERMINAL_READER_ID } =
	await import('./gateway/fake-gateway');
const {
	terminalLocationId,
	terminalReaderId,
	readerTapCanBeSimulated,
	mintConnectionToken,
	TerminalNotConfiguredError
} = await import('./terminal-service');

describe('terminal service', () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) delete env[key];
		resetFakeGateway();
		initStripe(createFakeGateway());
	});

	it('uses the fake Location under the fake driver, whatever the env names', () => {
		env.STRIPE_TERMINAL_LOCATION_ID = 'tml_real';
		expect(terminalLocationId()).toBe(FAKE_TERMINAL_LOCATION_ID);
	});

	it('uses the configured Location under the live driver', () => {
		env.PAYMENTS_DRIVER = 'stripe';
		env.STRIPE_TERMINAL_LOCATION_ID = 'tml_real';
		expect(terminalLocationId()).toBe('tml_real');
	});

	it('has no Location under the live driver until one is configured', () => {
		env.PAYMENTS_DRIVER = 'stripe';
		expect(terminalLocationId()).toBeNull();
	});

	it('mints a token scoped to the Location, simulated off a live key', async () => {
		const token = await mintConnectionToken();
		expect(token).toEqual({
			secret: expect.stringMatching(/^pst_test_/),
			locationId: FAKE_TERMINAL_LOCATION_ID,
			simulated: true
		});
	});

	it('connects a real reader only on a live key', async () => {
		env.PAYMENTS_DRIVER = 'stripe';
		env.STRIPE_TERMINAL_LOCATION_ID = FAKE_TERMINAL_LOCATION_ID;
		env.STRIPE_SECRET_KEY = 'rk_live_x';
		expect((await mintConnectionToken()).simulated).toBe(false);
		env.STRIPE_SECRET_KEY = 'sk_test_x';
		expect((await mintConnectionToken()).simulated).toBe(true);
	});

	it('refuses to mint without a Location rather than an unscoped token', async () => {
		env.PAYMENTS_DRIVER = 'stripe';
		await expect(mintConnectionToken()).rejects.toBeInstanceOf(TerminalNotConfiguredError);
	});

	it('uses the fake reader under the fake driver, whatever the env names', () => {
		env.STRIPE_TERMINAL_READER_ID = 'tmr_real';
		expect(terminalReaderId()).toBe(FAKE_TERMINAL_READER_ID);
	});

	it('uses the configured reader under the live driver, and none until one is set', () => {
		env.PAYMENTS_DRIVER = 'stripe';
		expect(terminalReaderId()).toBeNull();
		env.STRIPE_TERMINAL_READER_ID = 'tmr_real';
		expect(terminalReaderId()).toBe('tmr_real');
	});

	it('simulates a reader tap under the fake or a test key, never on a live key', () => {
		expect(readerTapCanBeSimulated()).toBe(true);
		env.PAYMENTS_DRIVER = 'stripe';
		env.STRIPE_SECRET_KEY = 'sk_test_x';
		expect(readerTapCanBeSimulated()).toBe(true);
		env.STRIPE_SECRET_KEY = 'rk_live_x';
		expect(readerTapCanBeSimulated()).toBe(false);
	});
});
