import { describe, it, expect, vi, beforeEach } from 'vitest';

const dispatchEmailOnly = vi.fn(async () => undefined);
vi.mock('$lib/server/notification/dispatcher', () => ({
	dispatchEmailOnly: (...args: unknown[]) => dispatchEmailOnly(...(args as [])),
	dispatch: vi.fn()
}));

const captureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({
	captureException: (...args: unknown[]) => captureException(...(args as []))
}));

import {
	RESET_PASSWORD_TOKEN_TTL_SECONDS,
	buildPasswordChangedModel,
	buildResetPasswordModel,
	formatExpiry,
	sendPasswordChangedEmail,
	sendPasswordResetEmail
} from './auth-emails';

// The URL better-auth actually hands `sendResetPassword`: its own callback
// endpoint, with the page to land on carried as a query parameter.
const BETTER_AUTH_URL =
	'https://corvmc.org/api/auth/reset-password/PfQ2rN8xKvT1?callbackURL=%2Freset-password';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('formatExpiry', () => {
	it('renders whole hours as hours', () => {
		expect(formatExpiry(3600)).toBe('1 hour');
		expect(formatExpiry(7200)).toBe('2 hours');
	});

	it('falls back to minutes for anything that is not whole hours', () => {
		expect(formatExpiry(900)).toBe('15 minutes');
		expect(formatExpiry(60)).toBe('1 minute');
	});
});

describe('buildResetPasswordModel', () => {
	it('passes the reset URL through untouched, query string and all', () => {
		const model = buildResetPasswordModel({ name: 'Maya', resetUrl: BETTER_AUTH_URL });

		expect(model.resetUrl).toBe(BETTER_AUTH_URL);
	});

	it('says the same expiry the token is actually given', () => {
		const model = buildResetPasswordModel({ name: 'Maya', resetUrl: BETTER_AUTH_URL });

		expect(model.expiresIn).toBe(formatExpiry(RESET_PASSWORD_TOKEN_TTL_SECONDS));
	});

	it('greets by name, and omits the greeting when there is no usable one', () => {
		expect(buildResetPasswordModel({ name: 'Maya', resetUrl: BETTER_AUTH_URL }).greeting).toContain(
			'Maya'
		);
		expect(
			buildResetPasswordModel({ name: '   ', resetUrl: BETTER_AUTH_URL }).greeting
		).toBeUndefined();
		expect(buildResetPasswordModel({ resetUrl: BETTER_AUTH_URL }).greeting).toBeUndefined();
	});

	it('suppresses the layout line about notification preferences', () => {
		// There is no preference behind a reset, and a member who cannot sign in
		// cannot go and manage one.
		expect(buildResetPasswordModel({ resetUrl: BETTER_AUTH_URL }).transactional_only).toBe(true);
	});

	it('sets preview_text itself, because only the generic alias gets normalized', () => {
		expect(buildResetPasswordModel({ resetUrl: BETTER_AUTH_URL }).preview_text).toBeTruthy();
	});
});

describe('buildPasswordChangedModel', () => {
	it('tells the member their other sessions were ended', () => {
		const model = buildPasswordChangedModel({ name: 'Maya' });

		expect(model.paragraphs?.[0]?.text).toContain('signed out');
	});

	it('gives them somewhere to go if it was not them', () => {
		expect(buildPasswordChangedModel({ name: 'Maya' }).footnote).toContain('contact@corvmc.org');
	});

	it('is also not preference-governed', () => {
		expect(buildPasswordChangedModel({ name: 'Maya' }).transactional_only).toBe(true);
	});
});

describe('sending', () => {
	it('sends the reset on its own template, tagged so it is not a preference', async () => {
		await sendPasswordResetEmail({
			toEmail: 'maya@example.com',
			name: 'Maya',
			resetUrl: BETTER_AUTH_URL
		});

		expect(dispatchEmailOnly).toHaveBeenCalledWith(
			expect.objectContaining({
				toEmail: 'maya@example.com',
				templateAlias: 'password-reset',
				type: 'password_reset'
			})
		);
	});

	it('sends the changed notice on the generic template', async () => {
		await sendPasswordChangedEmail({ toEmail: 'maya@example.com', name: 'Maya' });

		expect(dispatchEmailOnly).toHaveBeenCalledWith(
			expect.objectContaining({ templateAlias: 'notification', type: 'password_changed' })
		);
	});

	it('reports a send failure rather than raising it', async () => {
		// The request that triggers this is documented to always succeed — it has
		// to, or the response itself would say whether the address exists.
		dispatchEmailOnly.mockRejectedValueOnce(new Error('Postmark is down'));

		await expect(
			sendPasswordResetEmail({ toEmail: 'maya@example.com', resetUrl: BETTER_AUTH_URL })
		).resolves.toBeUndefined();
		expect(captureException).toHaveBeenCalled();
	});
});
