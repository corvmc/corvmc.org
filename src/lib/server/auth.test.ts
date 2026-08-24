import { describe, it, expect, vi } from 'vitest';

// auth.ts pulls in db + sentry at import time; stub them so importing the
// module (for the pure reason-deriving helper) doesn't require a real DB.
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

import {
	AUTH_IP_ADDRESS_HEADERS,
	authRateLimitEnabled,
	buildVerifyPasswordUrl,
	deriveSignInAnomaly,
	isDeactivated,
	pbkdf2Hash,
	pbkdf2Verify,
	PBKDF2_ITERATIONS,
	scryptHash,
	scryptVerify
} from './auth';

describe('scrypt password hashing (default)', () => {
	it('round-trips a hashed password', async () => {
		const hash = await scryptHash('correct horse battery staple');
		expect(hash.startsWith('scrypt:')).toBe(true);
		expect(await scryptVerify(hash, 'correct horse battery staple')).toBe(true);
		expect(await scryptVerify(hash, 'wrong password')).toBe(false);
	});

	it('rejects a malformed hash without throwing', async () => {
		expect(await scryptVerify('not-a-scrypt-hash', 'whatever')).toBe(false);
	});
});

describe('PBKDF2 password hashing', () => {
	// Cloudflare Workers' Web Crypto throws NotSupportedError for PBKDF2 iteration
	// counts above 100,000. The constant must stay at or below that ceiling or all
	// sign-in/sign-up hashing breaks in production (Node's Web Crypto has no such
	// cap, so this guard is the only thing that catches a regression locally).
	it('keeps iterations within the Cloudflare Workers limit', () => {
		expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
	});

	it('round-trips a hashed password', async () => {
		const hash = await pbkdf2Hash('correct horse battery staple');
		expect(hash.startsWith(`pbkdf2:${PBKDF2_ITERATIONS}:`)).toBe(true);
		expect(await pbkdf2Verify(hash, 'correct horse battery staple')).toBe(true);
		expect(await pbkdf2Verify(hash, 'wrong password')).toBe(false);
	});
});

describe('buildVerifyPasswordUrl', () => {
	// Production LARAVEL_URL carried a trailing slash, which turned the verify
	// endpoint into `…//api/verify-password`. Laravel 404s the double slash, so
	// every un-migrated bcrypt user got "Invalid email or password." on sign-in.
	it('strips a trailing slash so the path has no double slash', () => {
		expect(buildVerifyPasswordUrl('https://example.test/')).toBe(
			'https://example.test/api/verify-password'
		);
	});

	it('strips multiple trailing slashes', () => {
		expect(buildVerifyPasswordUrl('https://example.test///')).toBe(
			'https://example.test/api/verify-password'
		);
	});

	it('leaves a slash-free base unchanged', () => {
		expect(buildVerifyPasswordUrl('https://example.test')).toBe(
			'https://example.test/api/verify-password'
		);
	});
});

describe('deriveSignInAnomaly', () => {
	it('flags a missing user', () => {
		expect(
			deriveSignInAnomaly({
				userFound: false,
				hasCredentialAccount: false,
				credentialPassword: null
			})
		).toBe('user_not_found');
	});

	it('flags a user with no credential account', () => {
		expect(
			deriveSignInAnomaly({
				userFound: true,
				hasCredentialAccount: false,
				credentialPassword: null
			})
		).toBe('no_credential_account');
	});

	it('flags a credential account with an empty password', () => {
		expect(
			deriveSignInAnomaly({ userFound: true, hasCredentialAccount: true, credentialPassword: '' })
		).toBe('no_password');
	});

	it('flags a password stored in an unrecognized hash format', () => {
		expect(
			deriveSignInAnomaly({
				userFound: true,
				hasCredentialAccount: true,
				credentialPassword: 'plaintext-or-md5-garbage'
			})
		).toBe('unknown_hash_format');
	});

	it('returns null for a recognized bcrypt hash (verify handles correctness)', () => {
		expect(
			deriveSignInAnomaly({
				userFound: true,
				hasCredentialAccount: true,
				credentialPassword: '$2y$12$' + 'x'.repeat(53)
			})
		).toBeNull();
	});

	it('returns null for a recognized pbkdf2 hash', () => {
		expect(
			deriveSignInAnomaly({
				userFound: true,
				hasCredentialAccount: true,
				credentialPassword: 'pbkdf2:600000:abcd:ef01'
			})
		).toBeNull();
	});
});

describe('isDeactivated', () => {
	it('is false for null / undefined deletedAt', () => {
		expect(isDeactivated(null)).toBe(false);
		expect(isDeactivated(undefined)).toBe(false);
	});

	it('is true when deletedAt is a date', () => {
		expect(isDeactivated(new Date('2026-01-01'))).toBe(true);
	});
});

describe('client IP resolution', () => {
	// better-auth's default is `x-forwarded-for`, which a caller can append to.
	// It resolves no IP from a multi-entry header without a trustedProxies list,
	// and since 1.6.17 an unresolved IP means one shared rate-limit bucket rather
	// than a skipped check — so a single visitor sending their own XFF could hold
	// site-wide sign-in to better-auth's built-in 3 requests per 10 seconds.
	// CF-Connecting-IP is written by the edge and cannot be forged from outside.
	it('reads the client IP from a header the caller cannot forge', () => {
		expect(AUTH_IP_ADDRESS_HEADERS).toEqual(['cf-connecting-ip']);
		expect(AUTH_IP_ADDRESS_HEADERS).not.toContain('x-forwarded-for');
	});
});

describe('authRateLimitEnabled', () => {
	it('keeps rate limiting on for a deployed origin', () => {
		expect(authRateLimitEnabled('https://corvmc.org')).toBe(true);
		expect(authRateLimitEnabled('https://corvmc.devon-cash.workers.dev')).toBe(true);
	});

	// Nothing sets CF-Connecting-IP off Cloudflare, so under `vite preview` no IP
	// resolves and every sign-in in the e2e suite shares one bucket. Leaving the
	// limiter on there costs ~30 tests to timeouts on the login redirect.
	it('turns rate limiting off for a local preview or dev server', () => {
		expect(authRateLimitEnabled('http://localhost:4173')).toBe(false);
		expect(authRateLimitEnabled('http://localhost:5173')).toBe(false);
		expect(authRateLimitEnabled('http://some-band.localhost:4173')).toBe(false);
	});

	// isLocalOrigin fails open for Sentry's sake; here that direction is also the
	// safe one — an origin we cannot read keeps its limits.
	it('keeps rate limiting on when the origin is missing or unparseable', () => {
		expect(authRateLimitEnabled(undefined)).toBe(true);
		expect(authRateLimitEnabled('not-a-url')).toBe(true);
	});
});
