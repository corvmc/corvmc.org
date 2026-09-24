import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { initStripe } = await import('$lib/server/stripe');
const { createFakeGateway, resetFakeGateway, FAKE_TERMINAL_LOCATION_ID } =
	await import('./gateway/fake-gateway');
const { terminalLocationId, mintConnectionToken, TerminalNotConfiguredError } =
	await import('./terminal-service');

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
});
