import * as Sentry from '@sentry/sveltekit';

/**
 * Failures we don't want cluttering Sentry: anything carrying an HTTP status.
 * 4xx are expected user-facing outcomes (bad input, auth, not-found, conflicts);
 * 5xx are already captured server-side by `handleError` with full request
 * context — re-capturing the bare `{ status, body }` object here only produced
 * an unreadable duplicate issue (JAVASCRIPT-SVELTEKIT-D). Genuine client bugs —
 * network failures and thrown exceptions without an HTTP status — are reported.
 * Client-side form *validation* never reaches here; the `Form` component
 * handles that inline.
 */
function isExpected(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const status = (err as { status?: unknown }).status;
	return typeof status === 'number' && status >= 400;
}

/**
 * Central client-side error sink. Logs everything to the console and forwards
 * genuine errors to Sentry. Call this from anywhere in the browser when you've
 * caught an error you want visibility on. On the server, use
 * `#lib/server/sentry.js`'s `captureException` instead.
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
	console.error(err);
	if (isExpected(err)) return;
	Sentry.captureException(err, context ? { extra: context } : undefined);
}
