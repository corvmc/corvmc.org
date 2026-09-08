import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// auth.ts pulls in db + sentry at import time; the rest are the side effects
// the verification wiring is supposed to fire, stubbed so we can watch it.
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/directory/entry-service', () => ({ ensureUserEntry: vi.fn() }));
vi.mock('$lib/server/user/member-number-service', () => ({ assignMemberNumber: vi.fn() }));
vi.mock('$lib/server/marketing/subscriber-service', () => ({
	linkExistingSubscriberToUser: vi.fn()
}));
vi.mock('$lib/server/auth-emails', async (importOriginal) => ({
	...(await importOriginal<typeof import('./auth-emails')>()),
	sendVerifyEmail: vi.fn(),
	sendPasswordResetEmail: vi.fn(),
	sendPasswordChangedEmail: vi.fn()
}));

import { sendVerifyEmail, VERIFY_EMAIL_TOKEN_TTL_SECONDS } from './auth-emails';
import { linkExistingSubscriberToUser } from '$lib/server/marketing/subscriber-service';
import { emailVerificationConfig, onEmailVerified } from './auth';

const verified = { id: 'user-1', email: 'alice@example.com' };

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// #757: nothing verified a signup address, and subscriber linking trusted it.
// The decision was to verify without gating sign-in, so these cover both
// halves — that the mail goes out and the flag becomes real, and that no
// lockout came with it.
// ---------------------------------------------------------------------------

describe('email verification wiring', () => {
	it('sends the verification email on sign-up', () => {
		expect(emailVerificationConfig.sendOnSignUp).toBe(true);
	});

	it('hands better-auth its own link straight to the verify-email send', async () => {
		const url = 'https://corvmc.org/api/auth/verify-email?token=abc&callbackURL=%2Fmember';

		await emailVerificationConfig.sendVerificationEmail({
			user: { email: 'alice@example.com', name: 'Alice' },
			url
		});

		// Passed through untouched: the query string is what the template's
		// triple brace exists for.
		expect(sendVerifyEmail).toHaveBeenCalledWith({
			toEmail: 'alice@example.com',
			name: 'Alice',
			verifyUrl: url
		});
	});

	it('gives the link the TTL the email promises', () => {
		expect(emailVerificationConfig.expiresIn).toBe(VERIFY_EMAIL_TOKEN_TTL_SECONDS);
	});
});

describe('onEmailVerified', () => {
	it('claims the subscriber row once the link is clicked', async () => {
		await emailVerificationConfig.afterEmailVerification(verified);

		expect(linkExistingSubscriberToUser).toHaveBeenCalledWith('user-1', 'alice@example.com');
	});

	// A verification link is a signed JWT with no server-side single-use record,
	// so it can be presented twice inside its TTL. Nothing may move on the
	// second presentation, which is what makes the claim safe.
	it('cannot be replayed into stealing a row a second account holds', async () => {
		vi.mocked(linkExistingSubscriberToUser).mockResolvedValue(null);

		await expect(onEmailVerified(verified)).resolves.toBeUndefined();

		// The compare-and-swap in the service is the guard; the caller must not
		// second-guess a null by writing the row some other way.
		expect(linkExistingSubscriberToUser).toHaveBeenCalledTimes(1);
	});

	it('never lets a linking failure escape into the verification response', async () => {
		vi.mocked(linkExistingSubscriberToUser).mockRejectedValueOnce(new Error('boom'));

		await expect(onEmailVerified(verified)).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// The no-lockout half of the decision. Every account that predates this is
// unverified and there is no backfill, so `requireEmailVerification` would sign
// the whole collective out. Asserted against the source because the cost of
// the mistake is total and the option is one word.
// ---------------------------------------------------------------------------

describe('unverified accounts keep full access', () => {
	it('never sets requireEmailVerification', () => {
		expect(readFileSync('src/lib/server/auth.ts', 'utf8')).not.toContain(
			'requireEmailVerification: true'
		);
	});

	it('does not sign anyone in off the back of a verification click', () => {
		expect(emailVerificationConfig).not.toHaveProperty('autoSignInAfterVerification', true);
	});
});
