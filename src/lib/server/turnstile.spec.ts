import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// turnstile.ts reads $env/dynamic/private and reports to sentry. `mockEnv` is
// mutable so each test can set the ORIGIN the secret choice now depends on.
const { mockEnv, captureExceptionMock } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	captureExceptionMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/sentry', () => ({ captureException: captureExceptionMock }));

import { verifyTurnstile, turnstileSecret, TURNSTILE_TEST_SECRET } from './turnstile';
import { submitContactFormSchema } from './db/schema/inbox';

/** The `secret` field turnstile.ts actually put on the wire. */
function sentSecret(fetchMock: ReturnType<typeof vi.fn>): string | null {
	const body = fetchMock.mock.calls[0]?.[1]?.body as FormData | undefined;
	return (body?.get('secret') as string | null) ?? null;
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	// Local dev and CI both run with blank Turnstile keys, so this is the
	// baseline the existing fetch-contract tests below are written against.
	mockEnv.ORIGIN = 'http://localhost:5173';
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('turnstileSecret', () => {
	it('uses the configured secret wherever it is set', () => {
		expect(turnstileSecret('real-secret', 'https://corvmc.org')).toBe('real-secret');
		expect(turnstileSecret('real-secret', 'http://localhost:5173')).toBe('real-secret');
	});

	it('falls back to the always-pass test secret only on a local origin', () => {
		expect(turnstileSecret(undefined, 'http://localhost:5173')).toBe(TURNSTILE_TEST_SECRET);
		expect(turnstileSecret('', 'http://localhost:4173')).toBe(TURNSTILE_TEST_SECRET);
		expect(turnstileSecret(undefined, 'http://192.168.1.20:5173')).toBe(TURNSTILE_TEST_SECRET);
	});

	it('fails closed when the secret is missing off a local origin', () => {
		expect(turnstileSecret(undefined, 'https://corvmc.org')).toBeNull();
		expect(turnstileSecret('', 'https://corvmc.org')).toBeNull();
	});

	it('fails closed when the origin is absent or unparseable', () => {
		expect(turnstileSecret(undefined, undefined)).toBeNull();
		expect(turnstileSecret(undefined, 'not-a-url')).toBeNull();
	});
});

describe('verifyTurnstile', () => {
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

	it('sends the configured secret when one is set', async () => {
		mockEnv.ORIGIN = 'https://corvmc.org';
		mockEnv.TURNSTILE_SECRET_KEY = 'real-secret';
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile('a-token')).toBe(true);
		expect(sentSecret(fetchMock)).toBe('real-secret');
	});

	it('rejects rather than passing everyone when the production secret is unset (#625)', async () => {
		mockEnv.ORIGIN = 'https://corvmc.org';
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile('a-token')).toBe(false);
		// Never reaches siteverify at all — the always-pass secret would have
		// returned success for any token, bot or not.
		expect(fetchMock).not.toHaveBeenCalled();
		// And it is loud: the whole failure mode was that nothing noticed.
		expect(captureExceptionMock).toHaveBeenCalledOnce();
	});

	it('still uses the always-pass secret locally, so dev and CI keep working', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
		vi.stubGlobal('fetch', fetchMock);

		expect(await verifyTurnstile('a-token')).toBe(true);
		expect(sentSecret(fetchMock)).toBe(TURNSTILE_TEST_SECRET);
		expect(captureExceptionMock).not.toHaveBeenCalled();
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
