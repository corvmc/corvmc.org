import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env, loadStripe, reportError } = vi.hoisted(() => ({
	env: { PUBLIC_STRIPE_PUBLISHABLE_KEY: '' as string | undefined },
	loadStripe: vi.fn(),
	reportError: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({ env }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe }));
vi.mock('$lib/report-error', () => ({ reportError }));

async function load() {
	vi.resetModules();
	return import('./stripe');
}

/** The value of one `[vars]` entry in wrangler.toml, as production receives it. */
function wranglerVar(name: string): string | undefined {
	const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
	return new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(toml)?.[1];
}

describe('production config', () => {
	it('ships a live publishable key whenever the stripe driver is on', () => {
		if (wranglerVar('PAYMENTS_DRIVER') !== 'stripe') return;
		expect(wranglerVar('PUBLIC_STRIPE_PUBLISHABLE_KEY')).toMatch(/^pk_live_\w+$/);
	});
});

describe('loadStripeOrReport', () => {
	beforeEach(() => {
		loadStripe.mockReset();
		reportError.mockReset();
	});

	it('reports a missing key to Sentry without loading Stripe.js', async () => {
		env.PUBLIC_STRIPE_PUBLISHABLE_KEY = '';
		const { loadStripeOrReport } = await load();

		expect(await loadStripeOrReport('checkout')).toBeNull();
		expect(loadStripe).not.toHaveBeenCalled();
		expect(reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'PUBLIC_STRIPE_PUBLISHABLE_KEY is not set' }),
			{ surface: 'checkout' }
		);
	});

	it('reports Stripe.js failing to load', async () => {
		env.PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_x';
		loadStripe.mockResolvedValue(null);
		const { loadStripeOrReport } = await load();

		expect(await loadStripeOrReport('add-card')).toBeNull();
		expect(reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'Stripe.js failed to load' }),
			{ surface: 'add-card' }
		);
	});

	it('returns Stripe.js and reports nothing when it loads', async () => {
		env.PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_x';
		const stripe = {};
		loadStripe.mockResolvedValue(stripe);
		const { loadStripeOrReport } = await load();

		expect(await loadStripeOrReport('checkout')).toBe(stripe);
		expect(loadStripe).toHaveBeenCalledWith('pk_live_x');
		expect(reportError).not.toHaveBeenCalled();
	});
});
