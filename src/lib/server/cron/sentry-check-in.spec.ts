import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSentryCheckIn } from './sentry-check-in';

function stubFetch(response: Response | (() => Promise<Response>)) {
	const fetchMock = vi.fn<typeof fetch>(
		typeof response === 'function' ? response : async () => response
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof stubFetch>) {
	const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
	return { url, body: JSON.parse(init.body as string) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('createSentryCheckIn', () => {
	it('POSTs to the DSN-derived check-in URL for the monitor slug', async () => {
		const fetchMock = stubFetch(new Response('{}', { status: 201 }));

		const id = await createSentryCheckIn()({ slug: 'auto-complete', status: 'in_progress' });

		expect(id).toMatch(UUID);
		const { url } = lastCall(fetchMock);
		expect(url).toBe(
			'https://o4510014650384384.ingest.us.sentry.io/api/4511504553738240/cron/auto-complete/3b421fec8a5c7c5236b673d9ac5bdd9f/'
		);
	});

	it('upserts monitor_config on in_progress when a cron expression is given', async () => {
		const fetchMock = stubFetch(new Response('{}', { status: 201 }));

		await createSentryCheckIn('development')({
			slug: 'send-campaigns',
			status: 'in_progress',
			cron: '*/5 * * * *'
		});

		const { body } = lastCall(fetchMock);
		expect(body).toMatchObject({
			status: 'in_progress',
			environment: 'development',
			monitor_config: {
				schedule: { type: 'crontab', value: '*/5 * * * *' },
				timezone: 'Etc/UTC',
				checkin_margin: 10,
				max_runtime: 15
			}
		});
		expect(body.check_in_id).toMatch(UUID);
	});

	it('closes with check_in_id and no monitor_config, defaulting to production', async () => {
		const fetchMock = stubFetch(new Response('{}', { status: 201 }));

		await createSentryCheckIn()({ slug: 'lock-access', status: 'ok', checkInId: 'ci-3' });

		const { body } = lastCall(fetchMock);
		expect(body).toEqual({ status: 'ok', environment: 'production', check_in_id: 'ci-3' });
	});

	// -----------------------------------------------------------------------
	// JAVASCRIPT-SVELTEKIT-21
	// -----------------------------------------------------------------------
	// The id used to be read out of the opening RESPONSE. When Sentry recorded
	// the open check-in but the response was slow, aborted, or unparseable, the
	// id was lost and the close went out without one — which CREATES a second
	// check-in rather than closing the first, leaving it to time out at
	// max_runtime as a phantom outage.

	it('returns the id it sent, even when the opening response body is unreadable', async () => {
		const fetchMock = stubFetch(new Response('not json', { status: 202 }));

		const id = await createSentryCheckIn()({ slug: 'cancel-stale-tickets', status: 'in_progress' });

		const { body } = lastCall(fetchMock);
		expect(id).toMatch(UUID);
		// The returned id must be the one Sentry was told about.
		expect(id).toBe(body.check_in_id);
	});

	it('returns the id even when every attempt throws, so the close can still target it', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = stubFetch(() => Promise.reject(new Error('network down')));

		const id = await createSentryCheckIn()({ slug: 'cancel-stale-tickets', status: 'in_progress' });

		const { body } = lastCall(fetchMock);
		expect(id).toBe(body.check_in_id);
	});

	it('retries an opening check-in — a client-generated id makes the retry an idempotent update', async () => {
		let calls = 0;
		const fetchMock = stubFetch(async () => {
			calls++;
			if (calls === 1) throw new Error('network down');
			return new Response('{}', { status: 201 });
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await createSentryCheckIn()({ slug: 'auto-complete', status: 'in_progress' });

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
		const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
		// Same id both times — that is what makes the retry safe.
		expect(JSON.parse(first.body as string).check_in_id).toBe(
			JSON.parse(second.body as string).check_in_id
		);
		expect(warn).not.toHaveBeenCalled();
	});

	// JAVASCRIPT-SVELTEKIT-20: a dropped closing check-in leaves the in_progress
	// open until Sentry times it out and raises a phantom outage.
	it('retries a dropped closing check-in and reports success', async () => {
		let calls = 0;
		const fetchMock = stubFetch(async () => {
			calls++;
			if (calls === 1) throw new Error('network down');
			return new Response('{}', { status: 201 });
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const id = await createSentryCheckIn()({
			slug: 'reminders',
			status: 'ok',
			checkInId: 'ci-9'
		});

		expect(id).toBe('ci-9');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// A recovered check-in must not leave a scary line in the logs.
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not retry when the server rejected it — Sentry answered, an identical POST fares no better', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = stubFetch(new Response('rate limited', { status: 429 }));

		const id = await createSentryCheckIn()({
			slug: 'lock-access',
			status: 'error',
			checkInId: 'ci-10'
		});

		expect(id).toBe('ci-10');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledOnce();
	});

	it('gives up after the retry without throwing, keeping the error object for the logs', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const boom = new Error('network down');
		const fetchMock = stubFetch(() => Promise.reject(boom));

		const id = await createSentryCheckIn()({
			slug: 'auto-complete',
			status: 'ok',
			checkInId: 'ci-11'
		});

		expect(id).toBe('ci-11');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// One warn after all attempts, with the Error object as a structured
		// argument so Workers logs keep its stack.
		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('auto-complete'), boom);
	});

	it('bounds every attempt with an abort signal so a stalled connection cannot eat the cron budget', async () => {
		const fetchMock = stubFetch(new Response('{}', { status: 201 }));

		await createSentryCheckIn()({ slug: 'auto-complete', status: 'in_progress' });

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});
});
