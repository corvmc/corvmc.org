import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRequestEvent = vi.fn();
const captureException = vi.fn();

vi.mock('$app/server', () => ({ getRequestEvent }));
vi.mock('$lib/server/sentry', () => ({ captureException }));

// Module scope, not per-`beforeEach`: on a cold Vite cache the first import pays
// the transform of this module graph inside the hook timeout, and reports as a
// timeout rather than a slow build.
const { afterResponse } = await import('./after-response');

/** A promise plus the handles to settle it from the test. */
function deferred<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Stand in for a request whose platform carries a Workers execution context. */
function withExecutionContext() {
	const waitUntil = vi.fn();
	getRequestEvent.mockReturnValue({ platform: { ctx: { waitUntil } } });
	return waitUntil;
}

beforeEach(() => {
	vi.resetAllMocks();
});

describe('afterResponse on Workers', () => {
	// The whole point: the response goes out while the work is still running.
	it('returns before the work settles', async () => {
		const waitUntil = withExecutionContext();
		const work = deferred();
		let settled = false;
		void work.promise.then(() => (settled = true));

		await afterResponse(() => work.promise);

		// The response is free to go out with the send still in flight. Under the
		// previous inline `await`, this is the assertion that fails.
		expect(waitUntil).toHaveBeenCalledOnce();
		expect(settled).toBe(false);

		// And the runtime still finishes it, because that is what waitUntil buys.
		work.resolve();
		await work.promise;
		expect(settled).toBe(true);
	});

	it('hands the runtime a promise to keep the isolate alive for', async () => {
		const waitUntil = withExecutionContext();
		await afterResponse(async () => 'sent');
		expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
	});

	// A rejection inside waitUntil has nobody left to catch it — the response is
	// already gone — so it must be captured here or it surfaces as an unhandled
	// rejection with no context at all.
	it('captures a rejection instead of leaving it unhandled', async () => {
		const waitUntil = withExecutionContext();
		const boom = new Error('postmark said no');

		await afterResponse(() => Promise.reject(boom), { channel: 'email' });

		await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
		expect(captureException).toHaveBeenCalledWith(boom, { channel: 'email' });
	});
});

describe('afterResponse without an execution context', () => {
	// Seeds, scripts and specs all call into services directly. Deferring there
	// would silently drop the work, so the fallback is to await it — which keeps
	// the function's contract ("dealt with by the time I resolve") true.
	it('awaits the work when getRequestEvent throws', async () => {
		getRequestEvent.mockImplementation(() => {
			throw new Error('Called outside a request');
		});
		const run = vi.fn().mockResolvedValue(undefined);

		await afterResponse(run);

		expect(run).toHaveBeenCalledOnce();
	});

	it('awaits the work when the platform has no ctx', async () => {
		getRequestEvent.mockReturnValue({ platform: {} });
		const order: string[] = [];

		await afterResponse(async () => {
			order.push('work');
		});
		order.push('after');

		expect(order).toEqual(['work', 'after']);
	});

	it('still captures a rejection rather than throwing at the caller', async () => {
		getRequestEvent.mockReturnValue({ platform: undefined });
		const boom = new Error('nope');

		await expect(
			afterResponse(() => Promise.reject(boom), { channel: 'x' })
		).resolves.toBeUndefined();
		expect(captureException).toHaveBeenCalledWith(boom, { channel: 'x' });
	});
});
