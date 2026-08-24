/**
 * Shared between the Sentry noise filter (hooks.client.ts) and the recovery path
 * in the Form component, which must not import hooks.client — that module runs
 * `Sentry.init()` at import time and is SSR'd along with the component. Same
 * reasoning as sentry-local-origin.ts; deliberately no imports here.
 */

/**
 * True when a remote function's response wasn't JSON at all.
 *
 * After a deploy the remote endpoint URL carries a new build hash, so a tab
 * opened before the deploy POSTs to `/_app/remote/<old-hash>/…`, which no longer
 * resolves. The server answers with an HTML error page, and Kit's
 * `form.svelte.js` hands that to `devalue.parse` -> `JSON.parse`, which throws a
 * SyntaxError on the very first character (JAVASCRIPT-SVELTEKIT-24). The
 * `updated.current` guard in `+layout.svelte` doesn't cover this: it only fires
 * in `beforeNavigate`, and a form submit is not a navigation.
 *
 * Browsers word the message differently — Firefox "unexpected character",
 * Chrome "Unexpected token", Safari "is not valid JSON" — so match all three.
 * The type check does the real narrowing; a non-SyntaxError never qualifies.
 */
export function isStaleRemoteResponse(error: unknown): boolean {
	if (!(error instanceof SyntaxError)) return false;
	const message = error.message;
	return (
		message.includes('unexpected character') ||
		message.includes('Unexpected token') ||
		message.includes('is not valid JSON')
	);
}
