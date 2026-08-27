import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { account } from '$lib/server/db/schema/authentication';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and } from 'drizzle-orm';
import { userAdditionalFields } from './auth-fields';
import { captureException } from '$lib/server/sentry';
import { verifyTurnstile } from '$lib/server/turnstile';
import { isLocalOrigin } from '$lib/sentry-local-origin';
// ---------------------------------------------------------------------------
// PBKDF2 password hashing via Web Crypto API
// ---------------------------------------------------------------------------
// @noble/hashes scrypt is silently broken on Cloudflare Workers — it returns
// in 0ms with non-deterministic garbage. bcrypt-ts has the same issue.
// PBKDF2-SHA-256 via Web Crypto is natively supported on Workers.
// Format: "pbkdf2:iterations:salt_hex:key_hex"
//
// Cloudflare Workers' Web Crypto caps PBKDF2 at 100,000 iterations — anything
// higher throws `NotSupportedError: iteration counts above 100000 are not
// supported`, which silently broke every hash()/verify() call (and therefore
// all email/password sign-in). 100_000 is the maximum the runtime allows.
// ---------------------------------------------------------------------------

export const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 32;

function hexEncode(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

export async function pbkdf2Hash(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const derived = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		PBKDF2_KEY_LEN * 8
	);
	return `pbkdf2:${PBKDF2_ITERATIONS}:${hexEncode(salt)}:${hexEncode(derived)}`;
}

export async function pbkdf2Verify(hash: string, password: string): Promise<boolean> {
	const parts = hash.split(':');
	if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false;

	const iterations = parseInt(parts[1], 10);
	const salt = hexDecode(parts[2]);
	const expectedKey = hexDecode(parts[3]);

	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const derived = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
			keyMaterial,
			expectedKey.length * 8
		)
	);

	if (derived.length !== expectedKey.length) return false;
	let diff = 0;
	for (let i = 0; i < derived.length; i++) {
		diff |= derived[i] ^ expectedKey[i];
	}
	return diff === 0;
}

// ---------------------------------------------------------------------------
// scrypt password hashing via node:crypto (the default going forward)
// ---------------------------------------------------------------------------
// This is better-auth's own algorithm and parameters. On Cloudflare Workers the
// pure-JS @noble/hashes scrypt that better-auth falls back to is broken, but the
// `nodejs_compat` flag (see wrangler.toml) exposes the native node:crypto scrypt,
// which works and is far stronger than the 100k-iteration PBKDF2 ceiling Workers
// imposes on Web Crypto. node's default maxmem (32 MiB) is just under what these
// params need, so maxmem is raised to 64 MiB to match better-auth.
// Format: "scrypt:N:r:p:salt_hex:key_hex"
//
// NOTE: scrypt costs ~80ms of CPU per hash; this requires the Workers Paid plan
// (or Standard usage model). On the Free plan it exceeds the per-request CPU cap.
// ---------------------------------------------------------------------------

const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, keylen: 64, maxmem: 128 * 16384 * 16 * 2 };

function scryptDerive(password: string, salt: Buffer, p = SCRYPT_PARAMS): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password.normalize('NFKC'),
			salt,
			p.keylen,
			{ N: p.N, r: p.r, p: p.p, maxmem: p.maxmem },
			(err, derivedKey) => (err ? reject(err) : resolve(derivedKey))
		);
	});
}

export async function scryptHash(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await scryptDerive(password, salt);
	const { N, r, p } = SCRYPT_PARAMS;
	return `scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function scryptVerify(hash: string, password: string): Promise<boolean> {
	const parts = hash.split(':');
	if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
	const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
	const expectedKey = Buffer.from(keyHex, 'hex');
	const derived = await scryptDerive(password, Buffer.from(saltHex, 'hex'), {
		N: parseInt(nStr, 10),
		r: parseInt(rStr, 10),
		p: parseInt(pStr, 10),
		keylen: expectedKey.length,
		maxmem: SCRYPT_PARAMS.maxmem
	});
	return derived.length === expectedKey.length && timingSafeEqual(derived, expectedKey);
}

// ---------------------------------------------------------------------------
// bcrypt → scrypt migration via Laravel proxy
// ---------------------------------------------------------------------------

// Build the verify-password endpoint URL. LARAVEL_URL is operator-configured and
// has historically carried a trailing slash (the production var did), which would
// otherwise produce `…//api/verify-password` — a double slash that Laravel's
// router 404s, silently failing sign-in for every un-migrated bcrypt user.
export function buildVerifyPasswordUrl(laravelUrl: string): string {
	return `${laravelUrl.replace(/\/+$/, '')}/api/verify-password`;
}

async function verifyBcryptViaLaravel(hash: string, password: string): Promise<boolean> {
	const laravelUrl = env.LARAVEL_URL;
	const migrationSecret = env.MIGRATION_SECRET;

	if (!laravelUrl || !migrationSecret) {
		captureException(
			new Error(
				'bcrypt migration: a bcrypt hash needs migration but LARAVEL_URL/MIGRATION_SECRET are unset'
			),
			{
				event: 'auth.bcrypt_migration',
				stage: 'config_missing',
				hasLaravelUrl: Boolean(laravelUrl),
				hasMigrationSecret: Boolean(migrationSecret)
			}
		);
		return false;
	}

	const [acctRow] = await db
		.select({ userId: account.userId })
		.from(account)
		.where(and(eq(account.providerId, 'credential'), eq(account.password, hash)));

	if (!acctRow) {
		captureException(
			new Error('bcrypt migration: no credential account matches the supplied hash'),
			{ event: 'auth.bcrypt_migration', stage: 'account_not_found' }
		);
		return false;
	}

	const [userRow] = await db
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, acctRow.userId));

	if (!userRow) {
		captureException(new Error('bcrypt migration: credential account has no matching user'), {
			event: 'auth.bcrypt_migration',
			stage: 'user_not_found',
			userId: acctRow.userId
		});
		return false;
	}

	try {
		const fetchUrl = buildVerifyPasswordUrl(laravelUrl);

		const res = await fetch(fetchUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Migration-Secret': migrationSecret
			},
			body: JSON.stringify({ email: userRow.email, password })
		});

		const body = await res.text();

		if (!res.ok) {
			captureException(
				new Error(`bcrypt migration: Laravel verify-password returned ${res.status}`),
				{
					event: 'auth.bcrypt_migration',
					stage: 'laravel_response',
					status: res.status,
					email: userRow.email
				}
			);
			return false;
		}

		const { valid } = JSON.parse(body) as { valid: boolean };

		if (valid) {
			const newHash = await scryptHash(password);

			await db.update(account).set({ password: newHash }).where(eq(account.password, hash));
		} else {
			// Laravel reached and authoritative, but rejected the credentials. This is
			// the one bcrypt path that previously failed silently — surface it so a
			// migration that rejects a known-good password is visible.
			captureException(
				new Error('bcrypt migration: Laravel verify-password rejected the credentials'),
				{
					event: 'auth.bcrypt_migration',
					stage: 'invalid_credentials',
					email: userRow.email
				}
			);
		}

		return valid;
	} catch (err) {
		captureException(err, {
			event: 'auth.bcrypt_migration',
			stage: 'request',
			email: userRow.email
		});
		return false;
	}
}

// ---------------------------------------------------------------------------
// Sign-in failure diagnostics
// ---------------------------------------------------------------------------
// better-auth's /sign-in/email throws the same generic INVALID_EMAIL_OR_PASSWORD
// for several structurally different failures, all before the `verify` callback
// runs. This before-hook does a read-only lookup and reports the *structural*
// anomalies (not ordinary wrong passwords) so they're distinguishable in Sentry.

export type SignInAnomaly =
	'user_not_found' | 'no_credential_account' | 'no_password' | 'unknown_hash_format';

/** Pure reason-derivation for a sign-in attempt; returns null when nothing is structurally wrong. */
export function deriveSignInAnomaly(input: {
	userFound: boolean;
	hasCredentialAccount: boolean;
	credentialPassword: string | null | undefined;
}): SignInAnomaly | null {
	if (!input.userFound) return 'user_not_found';
	if (!input.hasCredentialAccount) return 'no_credential_account';
	if (!input.credentialPassword) return 'no_password';
	const hash = input.credentialPassword;
	const known = hash.startsWith('scrypt:') || hash.startsWith('$2') || hash.startsWith('pbkdf2:');
	if (!known) return 'unknown_hash_format';
	return null;
}

/** True when a user row carries a deletedAt (soft-deleted / deactivated). */
export function isDeactivated(deletedAt: Date | null | undefined): boolean {
	return deletedAt != null;
}

/** Normalize a raw sign-in email body field, or null when not a usable string. */
function normalizeEmail(rawEmail: unknown): string | null {
	if (typeof rawEmail !== 'string') return null;
	const email = rawEmail.toLowerCase().trim();
	return email || null;
}

async function reportSignInAnomaly(rawEmail: unknown): Promise<void> {
	const email = normalizeEmail(rawEmail);
	if (!email) return;

	const [userRow] = await db
		.select({ id: user.id, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.email, email));

	const acctRow = userRow
		? (
				await db
					.select({ password: account.password })
					.from(account)
					.where(and(eq(account.userId, userRow.id), eq(account.providerId, 'credential')))
			)[0]
		: undefined;

	const reason = deriveSignInAnomaly({
		userFound: Boolean(userRow),
		hasCredentialAccount: Boolean(acctRow),
		credentialPassword: acctRow?.password
	});

	if (!reason) return;

	captureException(
		new Error(`auth.sign_in: ${reason}`),
		{
			event: 'auth.sign_in',
			stage: reason,
			email,
			emailVerified: userRow?.emailVerified ?? null,
			hasCredentialAccount: Boolean(acctRow),
			// prefix only — never log the full hash or the password
			hashPrefix: acctRow?.password ? acctRow.password.slice(0, 7) : null
		},
		// An unknown email is a routine visitor typo, not a fault — keep the
		// telemetry but don't page at error level (JAVASCRIPT-SVELTEKIT-1E).
		// The structural anomalies (credential/password missing on a real user)
		// stay at the default error level.
		reason === 'user_not_found' ? 'warning' : undefined
	);
}

// ---------------------------------------------------------------------------
// Client IP and rate limiting
// ---------------------------------------------------------------------------
// better-auth rate-limits by client IP, with a built-in rule of 3 requests per
// 10 seconds on /sign-in*. Which header it reads that IP from decides whether
// the limit protects anyone.
//
// The default is `x-forwarded-for`, which a caller can append to: Cloudflare
// adds the real address to whatever the client already sent, so a visitor who
// sends their own produces a two-entry header. better-auth refuses to guess
// which entry is real without a `trustedProxies` list and resolves no IP at
// all. It used to skip the check in that case; since 1.6.17 it drops the
// request into a single shared bucket instead, which would let one visitor hold
// site-wide sign-in to 3 requests per 10 seconds.
//
// CF-Connecting-IP is set by the edge, always a single address, and is not
// forgeable from outside. Name it and every request is bucketed by its own IP.
// ---------------------------------------------------------------------------

export const AUTH_IP_ADDRESS_HEADERS = ['cf-connecting-ip'];

/**
 * Rate limiting is on everywhere but a local server.
 *
 * Nothing sets CF-Connecting-IP off Cloudflare, so under `vite preview` no IP
 * resolves and the whole e2e suite shares the one /sign-in bucket — 104 tests
 * that each sign in against a budget of 3 per 10 seconds. Fails closed: an
 * origin that does not parse is treated as remote and keeps its limits.
 */
export function authRateLimitEnabled(origin: string | undefined): boolean {
	return !isLocalOrigin(origin);
}

// ---------------------------------------------------------------------------
// Auth instance (lazy-initialized)
// ---------------------------------------------------------------------------

type Auth = ReturnType<typeof createAuth>;
let _auth: Auth | undefined;

function createAuth() {
	const baseURL = env.ORIGIN;
	if (!baseURL) {
		throw new Error(
			'ORIGIN environment variable is required (used as better-auth baseURL). ' +
				'Set it to the deployment origin, e.g. https://corvmc.devon-cash.workers.dev'
		);
	}
	return betterAuth({
		baseURL,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema
		}),
		emailAndPassword: {
			enabled: true,
			password: {
				verify: async ({ hash, password }) => {
					if (hash.startsWith('scrypt:')) {
						return scryptVerify(hash, password);
					}
					if (hash.startsWith('$2')) {
						return verifyBcryptViaLaravel(hash, password);
					}
					// Legacy PBKDF2 hashes (written during the brief 100k-iteration
					// window before scrypt) still verify; they migrate to scrypt on
					// their owner's next successful bcrypt sign-in.
					if (hash.startsWith('pbkdf2:')) {
						return pbkdf2Verify(hash, password);
					}
					return false;
				},
				hash: scryptHash
			}
		},
		user: {
			additionalFields: userAdditionalFields
		},
		advanced: {
			ipAddress: { ipAddressHeaders: AUTH_IP_ADDRESS_HEADERS }
		},
		rateLimit: {
			enabled: authRateLimitEnabled(baseURL)
		},
		session: {
			// Every request resolved the session with a DB read, which Sentry's
			// performance detector flagged as blocking on remote POSTs
			// (JAVASCRIPT-SVELTEKIT-2B). The signed cookie carries the session for a
			// short window instead.
			//
			// The cost is that deactivation is no longer instantaneous: deactivateUser
			// purges the session rows, but a cached cookie is trusted without a read
			// until it ages out. 60s bounds that window — short enough that a
			// deactivated member can't meaningfully keep working, long enough to drop
			// nearly every repeat read. Raising it widens the window; don't, without
			// revisiting the gate in hooks.server.ts.
			cookieCache: {
				enabled: true,
				maxAge: 60
			}
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// Gate public sign-up behind Cloudflare Turnstile. The login page sends
				// the widget token in the x-turnstile-token header on register.
				if (ctx.path === '/sign-up/email') {
					const token = ctx.headers?.get('x-turnstile-token');
					const ip = ctx.headers?.get('CF-Connecting-IP');
					if (!(await verifyTurnstile(token, ip))) {
						throw new APIError('BAD_REQUEST', {
							message: 'Verification failed. Please try again.'
						});
					}
					return;
				}

				if (ctx.path !== '/sign-in/email') return;

				// Reject deactivated accounts before credentials are even checked.
				// Uses the same generic message as a bad password so a deactivated
				// account is indistinguishable from a wrong one (no enumeration).
				// Kept outside the diagnostics try/catch below, which swallows throws.
				const signInEmail = normalizeEmail((ctx.body as { email?: unknown } | undefined)?.email);
				if (signInEmail) {
					const [row] = await db
						.select({ deletedAt: user.deletedAt })
						.from(user)
						.where(eq(user.email, signInEmail));
					if (isDeactivated(row?.deletedAt)) {
						throw new APIError('UNAUTHORIZED', { message: 'Invalid email or password' });
					}
				}

				try {
					await reportSignInAnomaly((ctx.body as { email?: unknown } | undefined)?.email);
				} catch (err) {
					// Diagnostics must never break the sign-in flow.
					captureException(err, { event: 'auth.sign_in', stage: 'diagnostic_error' });
				}
			})
		},
		plugins: [
			sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
		]
	});
}

export const auth = new Proxy({} as Auth, {
	get(_target, prop, receiver) {
		if (!_auth) _auth = createAuth();
		return Reflect.get(_auth, prop, receiver);
	}
});
