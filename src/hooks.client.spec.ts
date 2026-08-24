import { describe, it, expect, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/sveltekit';

// Importing hooks.client runs Sentry.init and registers a window listener at
// module scope — stub both out so the module loads cleanly in node.
vi.mock('@sentry/sveltekit', () => ({
	init: vi.fn(),
	replayIntegration: vi.fn(() => ({})),
	handleErrorWithSentry: <T>(handler: T) => handler
}));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import {
	isStaleChunkError,
	isNetworkAbortError,
	isWebviewBridgeError,
	isFrameworkControlFlow
} from './hooks.client';

function eventWithTopFrame(fn: string | undefined): ErrorEvent {
	return {
		type: undefined,
		exception: {
			values: [
				{
					type: 'TypeError',
					stacktrace: {
						frames: [{ function: 'outerCaller' }, { function: fn }]
					}
				}
			]
		}
	} as unknown as ErrorEvent;
}

const emptyEvent = { type: undefined } as unknown as ErrorEvent;

describe('local-origin gating', () => {
	// The guard lives in `enabled`, not beforeSend: only a disabled SDK also
	// silences transactions, logs, and replays from a local preview server.
	async function initWithOrigin(origin: string) {
		vi.resetModules();
		vi.stubGlobal('location', new URL(origin));
		try {
			const sentry = await import('@sentry/sveltekit');
			await import('./hooks.client');
			return sentry.init as ReturnType<typeof vi.fn>;
		} finally {
			vi.unstubAllGlobals();
			vi.resetModules();
		}
	}

	it('disables the SDK entirely on a local preview origin (JAVASCRIPT-SVELTEKIT-1W/1X)', async () => {
		const init = await initWithOrigin('http://localhost:4173/directory');
		expect(init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
	});

	it('stays enabled on the production origin', async () => {
		const init = await initWithOrigin('https://corvmc.org/');
		expect(init).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
	});
});

describe('isWebviewBridgeError', () => {
	it('drops the Instagram webkit bridge crash (JAVASCRIPT-SVELTEKIT-1F)', () => {
		const err = new TypeError(
			"undefined is not an object (evaluating 'window.webkit.messageHandlers')"
		);
		expect(isWebviewBridgeError(eventWithTopFrame('sendDataToNative'), err)).toBe(true);
	});

	it('matches on the bridge message alone when no stacktrace is attached', () => {
		const err = new TypeError(
			"undefined is not an object (evaluating 'window.webkit.messageHandlers')"
		);
		expect(isWebviewBridgeError(emptyEvent, err)).toBe(true);
	});

	it('matches on a known bridge entry-point frame even with an unrelated message', () => {
		const err = new TypeError('undefined is not an object');
		expect(isWebviewBridgeError(eventWithTopFrame('sendPageHideMessage'), err)).toBe(true);
	});

	it('keeps genuine app errors', () => {
		const err = new TypeError("Cannot read properties of undefined (reading 'foo')");
		expect(isWebviewBridgeError(eventWithTopFrame('handleClick'), err)).toBe(false);
		expect(isWebviewBridgeError(emptyEvent, err)).toBe(false);
	});
});

describe('existing noise filters', () => {
	it('drops stale-deploy chunk failures', () => {
		expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
		expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
		expect(isStaleChunkError(new Error('boom'))).toBe(false);
	});

	it('drops browser fetch aborts', () => {
		expect(isNetworkAbortError(new TypeError('Failed to fetch'))).toBe(true);
		expect(isNetworkAbortError(new Error('Load failed'))).toBe(true);
		expect(isNetworkAbortError(new Error('boom'))).toBe(false);
	});
});

describe('stale remote response', () => {
	// Asserted through beforeSend rather than the predicate (which has its own
	// spec) so the wiring is covered: a filter that isn't called filters nothing.
	async function getBeforeSend() {
		vi.resetModules();
		try {
			const sentry = await import('@sentry/sveltekit');
			await import('./hooks.client');
			const init = sentry.init as unknown as ReturnType<typeof vi.fn>;
			return init.mock.calls[0][0].beforeSend as (
				event: ErrorEvent,
				hint: { originalException: unknown }
			) => ErrorEvent | null;
		} finally {
			vi.resetModules();
		}
	}

	// A tab left open across a deploy POSTs to a remote endpoint whose build hash
	// is gone, gets an HTML error page back, and devalue.parse throws
	// (JAVASCRIPT-SVELTEKIT-24). Form.svelte reloads onto the new build; this is
	// the backstop so the parse failure never lands in Sentry as a bug.
	it('is dropped by beforeSend', async () => {
		const beforeSend = await getBeforeSend();
		const err = new SyntaxError(
			'JSON.parse: unexpected character at line 1 column 1 of the JSON data'
		);
		expect(beforeSend(emptyEvent, { originalException: err })).toBeNull();
	});

	it('still reports a SyntaxError unrelated to JSON parsing', async () => {
		const beforeSend = await getBeforeSend();
		const err = new SyntaxError('Invalid regular expression flags');
		expect(beforeSend(emptyEvent, { originalException: err })).toBe(emptyEvent);
	});
});

describe('framework control-flow rejections', () => {
	// Both payloads are copied from the real Sentry events. Neither is an Error,
	// so they carry no message and no stack — every message-based filter misses
	// them.
	it('drops a Redirect thrown to settle a remote query promise', () => {
		expect(isFrameworkControlFlow({ status: 307, location: '/member/volunteer/start' })).toBe(true);
	});

	it('drops an expected 4xx HttpError', () => {
		expect(
			isFrameworkControlFlow({
				status: 403,
				body: { message: 'You are not a member of this band' }
			})
		).toBe(true);
	});

	it('keeps a 5xx HttpError — a genuine server fault is still worth seeing', () => {
		expect(isFrameworkControlFlow({ status: 500, body: { message: 'Internal Error' } })).toBe(
			false
		);
	});

	it('ignores ordinary errors and non-objects', () => {
		expect(isFrameworkControlFlow(new Error('boom'))).toBe(false);
		expect(isFrameworkControlFlow(null)).toBe(false);
		expect(isFrameworkControlFlow('nope')).toBe(false);
		expect(isFrameworkControlFlow({ status: 'not-a-number', location: '/x' })).toBe(false);
	});

	it('does not drop a bare status-bearing object with neither shape', () => {
		expect(isFrameworkControlFlow({ status: 404 })).toBe(false);
	});
});
