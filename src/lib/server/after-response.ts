import { getRequestEvent } from '$app/server';
import { captureException } from '#lib/server/sentry.js';

/**
 * Run work that the caller's response does not depend on.
 *
 * On Workers this hands the promise to `waitUntil`, which keeps the
 * isolate alive until it settles but lets the response go out now. The
 * motivating case is transactional email: a Postmark round trip was sitting on
 * the request path of every notification, so a member confirming a booking
 * waited on an email addressed to somebody else.
 *
 * Errors are captured here rather than left to the caller. A rejection inside
 * `waitUntil` has nobody to catch it — the response is already gone — so it
 * would otherwise surface as an unhandled rejection with no context, which is
 * the one shape of failure that tells you nothing.
 *
 * Falls back to awaiting when no `waitUntil` is registered: a vitest run, or
 * any call made outside a request. That keeps the function's contract honest
 * ("this has been dealt with by the time I resolve") rather than silently
 * dropping the work.
 */
export async function afterResponse(
	run: () => Promise<unknown>,
	tags: Record<string, unknown> = {}
): Promise<void> {
	const guarded = async () => {
		try {
			await run();
		} catch (err) {
			captureException(err, tags);
		}
	};

	if (registeredWaitUntil && inRequest()) registeredWaitUntil(guarded());
	else await guarded();
}

let registeredWaitUntil: ((promise: Promise<unknown>) => void) | null = null;

/**
 * Hand this module the Workers runtime's `waitUntil`. Only hooks.server.ts
 * calls it, because only the Worker can import `cloudflare:workers`: seeds and
 * scripts reach this module through services under tsx, where that import fails.
 */
export function registerWaitUntil(waitUntil: ((promise: Promise<unknown>) => void) | null): void {
	registeredWaitUntil = waitUntil;
}

/** `getRequestEvent` throws outside a request, which is normal for specs and scripts. */
function inRequest(): boolean {
	try {
		getRequestEvent();
		return true;
	} catch {
		return false;
	}
}
