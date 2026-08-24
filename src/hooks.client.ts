import { handleErrorWithSentry, replayIntegration } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { SENTRY_DSN } from '$lib/sentry-dsn';
import { isLocalOrigin } from '$lib/sentry-local-origin';
import { isStaleRemoteResponse } from '$lib/stale-remote-response';

/**
 * Expected stale-deploy chunk failures: a tab opened before a deploy can't load
 * a route module whose immutable filename changed. The `vite:preloadError`
 * listener below reloads onto the fresh build, so these are recoverable noise,
 * not faults — drop them before they reach Sentry.
 */
export function isStaleChunkError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return (
		message.includes('dynamically imported module') ||
		message.includes('Importing a module script failed')
	);
}

/**
 * Fetch aborted by the browser, usually because the user navigated away mid-request
 * or briefly lost connectivity. Not actionable and not our bug — drop it.
 */
export function isNetworkAbortError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return (
		message.includes('NetworkError when attempting to fetch resource') ||
		message.includes('Failed to fetch') ||
		message.includes('Load failed')
	);
}

/**
 * In-app webviews (Instagram, Facebook, …) inject their own native-bridge
 * scripts into every page; when those crash — e.g. reading
 * `window.webkit.messageHandlers` outside the host app — the error is
 * attributed to our document URL even though none of our code is involved
 * (JAVASCRIPT-SVELTEKIT-1F). We never reference the webkit bridge, so drop
 * anything mentioning it or thrown from the bridge's known entry points.
 */
const WEBVIEW_BRIDGE_FUNCTIONS = ['sendDataToNative', 'sendPageHideMessage'];

export function isWebviewBridgeError(event: Sentry.ErrorEvent, error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	if (message.includes('window.webkit.messageHandlers')) return true;
	// Sentry stacktraces are ordered caller → callee, so the crashing frame is last.
	const frames = event.exception?.values?.[0]?.stacktrace?.frames;
	const top = frames?.[frames.length - 1];
	return Boolean(top?.function && WEBVIEW_BRIDGE_FUNCTIONS.includes(top.function));
}

/**
 * SvelteKit's own control-flow values reaching `window.onunhandledrejection`.
 *
 * `redirect()` and `error()` throw plain class instances — `Redirect
 * {status, location}` and `HttpError {status, body}` — that are NOT `Error`
 * subclasses, so they arrive with no message and no stacktrace and Sentry
 * titles them "Object captured as promise rejection with keys: …"
 * (JAVASCRIPT-SVELTEKIT-X and -3).
 *
 * They escape because a remote function's rejection outlives its consumer: for
 * a redirect, Kit awaits `goto()` and *then* throws to settle the dangling
 * query promise, by which point the component and its boundary are unmounted,
 * so no boundary can ever catch it. The existing 4xx filter can't help either
 * — it lives in `reportError`, a manual sink that unhandled rejections never
 * reach.
 *
 * Redirects are always control flow. HttpErrors are dropped only below 500, so
 * a genuine server fault still reports.
 */
export function isFrameworkControlFlow(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const { status, location, body } = error as {
		status?: unknown;
		location?: unknown;
		body?: unknown;
	};
	if (typeof status !== 'number') return false;

	// Redirect: 3xx with a destination.
	if (typeof location === 'string') return status >= 300 && status < 400;

	// HttpError: expected 4xx carrying a body.
	return body !== undefined && status >= 400 && status < 500;
}

Sentry.init({
	beforeSend(event, hint) {
		if (isStaleChunkError(hint?.originalException)) return null;
		if (isNetworkAbortError(hint?.originalException)) return null;
		if (isStaleRemoteResponse(hint?.originalException)) return null;
		if (isWebviewBridgeError(event, hint?.originalException)) return null;
		if (isFrameworkControlFlow(hint?.originalException)) return null;
		return event;
	},

	dsn: SENTRY_DSN,

	environment: env.PUBLIC_SENTRY_ENVIRONMENT ?? (dev ? 'development' : 'production'),

	// Don't report from local dev or the Playwright/preview e2e run (env set in
	// playwright.config.ts). The env-var gate fails open when a preview server is
	// reused or hand-started outside Playwright, so also check the page origin —
	// gating `enabled` (not beforeSend) is what silences EVERY envelope type:
	// beforeSend only sees error events, while transactions, logs, and session
	// replays ship through channels it never touches. The origin is fixed for the
	// life of the page, so one check at init is complete.
	enabled:
		!dev && env.PUBLIC_SENTRY_ENVIRONMENT !== 'ci' && !isLocalOrigin(globalThis.location?.href),

	tracesSampleRate: 1.0,

	// Enable logs to be sent to Sentry
	enableLogs: true,

	// This sets the sample rate to be 10%. You may want this to be 100% while
	// in development and sample at a lower rate in production
	replaysSessionSampleRate: 0.1,

	// If the entire session is not sampled, use the below sample rate to sample
	// sessions when an error occurs.
	replaysOnErrorSampleRate: 1.0,

	// If you don't want to use Session Replay, just remove the line below:
	integrations: [replayIntegration()],

	// Enable sending user PII (Personally Identifiable Information)
	// https://docs.sentry.io/platforms/javascript/guides/sveltekit/configuration/options/#sendDefaultPii
	sendDefaultPii: true
});

// A new deploy replaces the immutable chunk files, so a tab opened before the
// deploy fails to lazy-load a route module ("error loading dynamically imported
// module"). This is expected, not a bug — recover by reloading onto the new
// build. The timestamp guard suppresses a reload loop if the asset is genuinely
// gone (rapid repeat) while still allowing recovery from a later, separate deploy.
if (typeof window !== 'undefined') {
	window.addEventListener('vite:preloadError', () => {
		const key = 'preload-error-reloaded-at';
		const last = Number(sessionStorage.getItem(key) ?? 0);
		if (Date.now() - last < 10_000) return;
		sessionStorage.setItem(key, String(Date.now()));
		window.location.reload();
	});
}

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
