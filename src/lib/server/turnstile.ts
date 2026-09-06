import { env } from '$env/dynamic/private';
import { isLocalOrigin } from '$lib/sentry-local-origin';
import { captureException } from '$lib/server/sentry';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cloudflare's documented "always passes" test secret. Used when no real secret
// is configured (local dev, CI, tests) so verification succeeds without a key.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

interface SiteVerifyResponse {
	success: boolean;
	'error-codes'?: string[];
}

/**
 * Which secret to send to siteverify — or `null`, meaning refuse to verify.
 *
 * The test secret passes everyone by design, so it is only ever reachable from
 * a local origin: `pnpm dev`, `.env.cloud` and the Playwright preview all ship
 * blank Turnstile keys on purpose and would otherwise have no working sign-up.
 * Off a local origin a missing secret is a misconfiguration, not a licence to
 * wave bots through — Turnstile is the only bot protection on four of its five
 * call sites. Fails closed on an origin that is absent or does not parse, the
 * same way `authRateLimitEnabled` treats one as remote.
 */
export function turnstileSecret(
	secret: string | undefined,
	origin: string | undefined
): string | null {
	if (secret) return secret;
	return isLocalOrigin(origin) ? TURNSTILE_TEST_SECRET : null;
}

/**
 * Verify a Cloudflare Turnstile token against the siteverify endpoint.
 * Returns false (never throws) on a missing token, missing secret, network
 * error, or rejection, so callers can treat the result as a simple pass/fail
 * gate.
 */
export async function verifyTurnstile(
	token: string | undefined | null,
	remoteIp?: string | null
): Promise<boolean> {
	if (!token) return false;

	const secret = turnstileSecret(env.TURNSTILE_SECRET_KEY, env.ORIGIN);
	if (!secret) {
		// Deny rather than fall back — but say so, because the whole failure mode
		// was that an unset production secret was completely silent.
		captureException(new Error('turnstile: TURNSTILE_SECRET_KEY is not set'), {
			event: 'turnstile.verify',
			stage: 'missing_secret',
			origin: env.ORIGIN
		});
		return false;
	}

	const body = new FormData();
	body.append('secret', secret);
	body.append('response', token);
	if (remoteIp) body.append('remoteip', remoteIp);

	try {
		const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
		if (!res.ok) {
			captureException(new Error(`turnstile: siteverify returned ${res.status}`), {
				event: 'turnstile.verify',
				stage: 'http_error',
				status: res.status
			});
			return false;
		}
		const data = (await res.json()) as SiteVerifyResponse;
		return data.success === true;
	} catch (err) {
		captureException(err, { event: 'turnstile.verify', stage: 'request' });
		return false;
	}
}
