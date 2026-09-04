import type { RemoteFormIssue } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

// Cloudflare's documented "always passes" test site key. Used when no real key
// is configured (local dev, CI, tests) so the widget renders and auto-solves.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

/** Public Turnstile site key for the client widget; falls back to the test key. */
export const TURNSTILE_SITE_KEY = env.PUBLIC_TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY;

// Name of the hidden input the widget renders into each form. We override the
// library default ('cf-turnstile-response') with a valid identifier so it can be
// a Zod schema key and a SvelteKit `issue.<field>()` path (which rejects hyphens).
export const TURNSTILE_RESPONSE_FIELD = 'turnstileToken';

/**
 * What to tell someone whose submission did not go through.
 *
 * `turnstileToken` is a field with no visible input: Cloudflare's widget writes
 * it, and the widget only exists once its script has loaded and rendered.
 * Submit before that happens — a slow connection, a blocked challenge script,
 * an impatient click — and the schema rejects the form on a field that has
 * nowhere to render an error.
 *
 * On the band contact forms that was silent twice over. There is no `FormField`
 * for it, so the issue had no home; and both forms pass an `onfailure` handler
 * to reset the widget, which suppresses `Form`'s own fallback toast. The result
 * was a Send button that did nothing at all, on the only route a stranger has
 * to reach an act.
 */
export function turnstileFailureMessage(issues: RemoteFormIssue[] | null): string {
	const unverified = issues?.some((issue) => issue.path[0] === TURNSTILE_RESPONSE_FIELD);
	return unverified
		? 'We are still checking you are human. Give it a moment, then send again.'
		: 'That did not send. Please check the fields above and try again.';
}
