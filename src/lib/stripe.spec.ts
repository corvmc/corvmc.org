import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env, loadStripe, reportError } = vi.hoisted(() => ({
	env: { PUBLIC_STRIPE_PUBLISHABLE_KEY: '' as string | undefined },
	loadStripe: vi.fn(),
	reportError: vi.fn()
}));

vi.mock('$app/env/public', async () => (await import('#lib/testing/env-mock.js')).envMock(env));
vi.mock('@stripe/stripe-js', () => ({ loadStripe }));
vi.mock('#lib/report-error.js', () => ({ reportError }));

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

describe('withStripeDeadline', () => {
	beforeEach(() => {
		reportError.mockReset();
		vi.useFakeTimers();
		return () => vi.useRealTimers();
	});

	it('resolves timed_out and reports when confirm never settles', async () => {
		const { withStripeDeadline } = await load();
		const result = withStripeDeadline(new Promise<never>(() => {}), 'checkout', 1000);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(result).resolves.toBe('timed_out');
		expect(reportError).toHaveBeenCalledOnce();
		expect(reportError.mock.calls[0][1]).toMatchObject({ surface: 'checkout', ms: 1000 });
	});

	it("returns confirm's result and reports nothing when it settles first", async () => {
		const { withStripeDeadline } = await load();
		const result = withStripeDeadline(Promise.resolve({ type: 'error' }), 'checkout', 1000);
		await expect(result).resolves.toEqual({ type: 'error' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(reportError).not.toHaveBeenCalled();
	});
});

// Class guard (#2862): a Stripe confirm awaited with no deadline leaves its
// button pending forever when Stripe's challenge cannot finish. Every confirm
// call in src goes through `withStripeDeadline`.
describe('Stripe confirm calls', () => {
	it('all pass through withStripeDeadline', async () => {
		const { globSync } = await import('node:fs');
		const files = globSync('src/**/*.{svelte,ts}', {
			cwd: new URL('../../', import.meta.url).pathname
		}).filter((f) => !/\.(spec|test)\.ts$/.test(f) && !f.includes('/server/'));
		const root = new URL('../../', import.meta.url);
		const confirmCall = /\b(?:stripe\.confirm\w*|actions\.confirm)\(/g;
		const offenders: string[] = [];
		for (const file of files) {
			const text = readFileSync(new URL(file, root), 'utf8');
			for (const match of text.matchAll(confirmCall)) {
				const line = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index).trim();
				if (line.startsWith('*') || line.startsWith('//')) continue;
				const before = text.slice(Math.max(0, match.index - 80), match.index);
				if (!before.includes('withStripeDeadline(')) offenders.push(`${file}: ${match[0]}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
