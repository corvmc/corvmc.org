import { getRequestEvent } from '$app/server';
import { captureException } from '$lib/server/sentry';

/**
 * Run work that the caller's response does not depend on.
 *
 * On Workers this hands the promise to `ctx.waitUntil`, which keeps the
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
 * Falls back to awaiting when there is no execution context: a vitest run, or
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

	const ctx = executionContext();
	if (ctx) ctx.waitUntil(guarded());
	else await guarded();
}

/**
 * The current request's execution context, or null.
 *
 * `getRequestEvent` throws rather than returning undefined when called outside
 * a request, and "outside a request" is a normal state here — seeds, scripts
 * and specs all call into services directly.
 */
function executionContext(): ExecutionContext | null {
	try {
		return getRequestEvent().platform?.ctx ?? null;
	} catch {
		return null;
	}
}
