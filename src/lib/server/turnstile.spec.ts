import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// turnstile.ts reads $env/dynamic/private and reports to sentry; stub both so the
// module imports cleanly and falls back to the test secret.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

import { verifyTurnstile } from './turnstile';
import { submitContactFormSchema } from './db/schema/inbox';

describe('verifyTurnstile', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns true when siteverify reports success', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile('a-token')).toBe(true);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('returns false when siteverify rejects the token', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] })
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile('bad-token')).toBe(false);
	});

	it('returns false without calling siteverify when the token is missing', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile(undefined)).toBe(false);
		expect(await verifyTurnstile('')).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns false (does not throw) on a network error', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile('a-token')).toBe(false);
	});
});

describe('submitContactFormSchema turnstile gate', () => {
	const base = {
		name: 'Jane',
		email: 'jane@example.com',
		subject: 'General Inquiry',
		message: 'Hello there'
	};

	it('rejects a submission missing the turnstile token', () => {
		expect(submitContactFormSchema.safeParse(base).success).toBe(false);
	});

	it('accepts a submission with a turnstile token', () => {
		const result = submitContactFormSchema.safeParse({
			...base,
			turnstileToken: 'a-token'
		});
		expect(result.success).toBe(true);
	});
});
