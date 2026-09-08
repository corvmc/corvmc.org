import { describe, expect, it } from 'vitest';
import {
	E2E_STRIPE_SECRET_KEY,
	E2E_STRIPE_WEBHOOK_SECRET,
	assertNoTransactableStripeCredentials,
	findTransactableStripeCredentials,
	isTransactableStripeCredential
} from './stripe-guard';

describe('isTransactableStripeCredential', () => {
	it('accepts a test secret key', () => {
		expect(isTransactableStripeCredential('sk_test_abc123')).toBe(false);
	});

	it('accepts a restricted test key', () => {
		expect(isTransactableStripeCredential('rk_test_abc123')).toBe(false);
	});

	it('accepts the dummy the suite pins', () => {
		expect(isTransactableStripeCredential(E2E_STRIPE_SECRET_KEY)).toBe(false);
	});

	it('refuses a live secret key', () => {
		expect(isTransactableStripeCredential('sk_live_abc123')).toBe(true);
	});

	// The shape actually sitting in this repo's .env, and the one #667 is about.
	it('refuses a live restricted key', () => {
		expect(isTransactableStripeCredential('rk_live_abc123')).toBe(true);
	});

	// Fails closed: a prefix Stripe has not shipped yet is refused rather than
	// waved through, because the cost of guessing wrong is a real charge.
	it('refuses an unrecognised key class', () => {
		expect(isTransactableStripeCredential('sk_sandbox_abc123')).toBe(true);
	});

	it('ignores values that are not API credentials', () => {
		expect(isTransactableStripeCredential(E2E_STRIPE_WEBHOOK_SECRET)).toBe(false);
		expect(isTransactableStripeCredential('we_1234567890')).toBe(false);
		expect(isTransactableStripeCredential('')).toBe(false);
	});
});

describe('findTransactableStripeCredentials', () => {
	it('reports the variable name, and only the name', () => {
		const found = findTransactableStripeCredentials({
			STRIPE_SECRET_KEY: 'rk_live_supersecret'
		});
		expect(found).toEqual(['STRIPE_SECRET_KEY']);
	});

	it('passes an env pinned to the e2e dummies', () => {
		expect(
			findTransactableStripeCredentials({
				STRIPE_SECRET_KEY: E2E_STRIPE_SECRET_KEY,
				STRIPE_WEBHOOK_SECRET: E2E_STRIPE_WEBHOOK_SECRET,
				STRIPE_WEBHOOK_ID: 'we_dummy'
			})
		).toEqual([]);
	});

	// The whole point of #667: a live key exported in the shell must not be able
	// to ride into the preview server on a variable nobody remembered to pin.
	it('catches a live key on an unpinned variable in the namespace', () => {
		expect(
			findTransactableStripeCredentials({
				STRIPE_SECRET_KEY: E2E_STRIPE_SECRET_KEY,
				STRIPE_CONNECT_KEY: 'sk_live_abc123',
				PAYMENTS_FALLBACK_KEY: 'rk_live_abc123'
			})
		).toEqual(['PAYMENTS_FALLBACK_KEY', 'STRIPE_CONNECT_KEY']);
	});

	it('leaves unrelated variables alone', () => {
		expect(
			findTransactableStripeCredentials({
				BETTER_AUTH_SECRET: 'sk_live_looks_like_one_but_is_not_stripe',
				ORIGIN: 'http://localhost:4173'
			})
		).toEqual([]);
	});
});

describe('assertNoTransactableStripeCredentials', () => {
	it('is silent when nothing can transact', () => {
		expect(() =>
			assertNoTransactableStripeCredentials(
				{ STRIPE_SECRET_KEY: E2E_STRIPE_SECRET_KEY },
				'the e2e preview server'
			)
		).not.toThrow();
	});

	it('throws, naming the variable', () => {
		expect(() =>
			assertNoTransactableStripeCredentials(
				{ STRIPE_SECRET_KEY: 'rk_live_supersecret' },
				'the e2e preview server'
			)
		).toThrow(/STRIPE_SECRET_KEY/);
	});

	// The guard exists to prevent a leak; a guard that prints the key is a leak.
	it('never puts the credential in the message', () => {
		let message = '';
		try {
			assertNoTransactableStripeCredentials(
				{ STRIPE_SECRET_KEY: 'rk_live_supersecret' },
				'the e2e preview server'
			);
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).not.toContain('rk_live_supersecret');
		expect(message).not.toContain('supersecret');
	});
});
