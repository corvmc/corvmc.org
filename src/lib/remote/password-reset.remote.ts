import { z } from 'zod';
import { form, getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { allowRateLimited } from '$lib/server/rate-limit';

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
// The two remote functions in this file are the only unguarded ones in
// `$lib/remote`, and deliberately: a member who has forgotten their password
// cannot be asked to prove who they are first. The credential is the token in
// the emailed link — single-use, and expiring in
// RESET_PASSWORD_TOKEN_TTL_SECONDS. Everything else here exists to keep the
// request from becoming a way to learn things or to send mail on someone
// else's behalf.
// ---------------------------------------------------------------------------

/**
 * Per address, so one member's inbox cannot be filled from a form.
 * Three is enough for "did that send?" retries within the token's own lifetime.
 */
const REQUESTS_PER_EMAIL = 3;
/** Per source address, so one host cannot walk a list of addresses. */
const REQUESTS_PER_IP = 10;
const REQUEST_WINDOW_SECONDS = 3600;

const requestSchema = z.object({
	email: z.string().trim().email('Enter a valid email address').max(254)
});

/**
 * Ask for a reset link.
 *
 * Returns the same thing whatever happens — unknown address, throttled
 * address, throttled host, mail server down. better-auth's endpoint already
 * goes to the trouble of generating a dummy token and doing a dummy lookup on
 * the unknown-email path so the *timing* doesn't answer the question either;
 * throwing a 429 here would give away in one response what all of that is
 * protecting.
 */
export const requestPasswordReset = form(requestSchema, async (data) => {
	const email = data.email.toLowerCase();
	const ip = getRequestEvent().request.headers.get('CF-Connecting-IP');

	const [emailAllowed, ipAllowed] = await Promise.all([
		allowRateLimited(`pw-reset:email:${email}`, REQUESTS_PER_EMAIL, REQUEST_WINDOW_SECONDS),
		allowRateLimited(`pw-reset:ip:${ip ?? 'unknown'}`, REQUESTS_PER_IP, REQUEST_WINDOW_SECONDS)
	]);

	if (emailAllowed && ipAllowed) {
		// `redirectTo` is relative on purpose: better-auth resolves it against
		// its own baseURL, so this lands on our page whatever origin is serving.
		await auth.api.requestPasswordReset({
			body: { email, redirectTo: '/reset-password' }
		});
	}

	return { sent: true };
});

const resetSchema = z
	.object({
		token: z.string().min(1),
		newPassword: z.string().min(8, 'Password must be at least 8 characters'),
		confirmPassword: z.string().min(1, 'Please confirm your password')
	})
	.refine((d) => d.newPassword === d.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

/** True for the one failure this form can do anything useful about. */
function isInvalidToken(err: unknown): boolean {
	const body = (err as { body?: { code?: unknown } } | null)?.body;
	return body?.code === 'INVALID_TOKEN';
}

/**
 * Set the new password.
 *
 * better-auth consumes the token, hashes through the configured `password.hash`
 * (scrypt — which is what makes a reset the exit from a legacy bcrypt row) and
 * revokes every other session.
 */
export const resetPassword = form(resetSchema, async (data, issue) => {
	try {
		await auth.api.resetPassword({
			body: { token: data.token, newPassword: data.newPassword }
		});
	} catch (err) {
		if (isInvalidToken(err)) {
			invalid(
				issue.token('That reset link has expired or has already been used. Request a new one.')
			);
		}
		throw err;
	}

	return { reset: true };
});
