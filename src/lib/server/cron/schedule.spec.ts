import { describe, it, expect, vi } from 'vitest';
import { CRON_SCHEDULE, runScheduledJobs } from './schedule';
import type { CronCheckIn } from './sentry-check-in';

const env = { ORIGIN: 'https://corvmc.test', CRON_SECRET: 'test-secret' };

const ALL_ENDPOINTS = [
	'/api/cron/auto-complete',
	'/api/cron/cancel-stale-tickets',
	'/api/cron/cancel-unconfirmed',
	'/api/cron/expire-waitlisted',
	'/api/cron/wake-snoozed',
	'/api/cron/confirmation-reminders',
	'/api/cron/reservation-reminders',
	'/api/cron/generate-recurring-reservations',
	'/api/cron/lock-access',
	'/api/cron/send-campaigns',
	'/api/cron/complete-shifts',
	'/api/cron/shift-reminders',
	'/api/cron/shift-feedback',
	'/api/cron/sweep-media'
];

function okFetcher() {
	return vi.fn<(request: Request) => Promise<Response>>(
		async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
	);
}

describe('CRON_SCHEDULE', () => {
	it('covers every cron endpoint exactly once', () => {
		const scheduled = Object.values(CRON_SCHEDULE).flat();
		expect(scheduled.toSorted()).toEqual(ALL_ENDPOINTS.toSorted());
	});

	it('runs the daily batch in dependency order (generation before locks and reminders)', () => {
		expect(CRON_SCHEDULE['0 16 * * *']).toEqual([
			'/api/cron/generate-recurring-reservations',
			'/api/cron/lock-access',
			'/api/cron/confirmation-reminders',
			'/api/cron/reservation-reminders',
			'/api/cron/cancel-stale-tickets',
			// Shift reminders after the reservation ones, and the feedback ask last:
			// it reads signups that complete-shifts has been marking all night.
			'/api/cron/shift-reminders',
			'/api/cron/shift-feedback',
			// Last: it reaps what every job above may have deleted, and nothing
			// downstream reads its result.
			'/api/cron/sweep-media'
		]);
	});
});

describe('runScheduledJobs', () => {
	it('POSTs each mapped endpoint at ORIGIN with the bearer secret', async () => {
		const fetcher = okFetcher();

		const results = await runScheduledJobs('*/15 * * * *', env, fetcher);

		expect(fetcher).toHaveBeenCalledTimes(5);
		const requests = fetcher.mock.calls.map(([request]: [Request]) => request);
		expect(requests.map((r) => r.url)).toEqual([
			'https://corvmc.test/api/cron/auto-complete',
			'https://corvmc.test/api/cron/complete-shifts',
			'https://corvmc.test/api/cron/cancel-unconfirmed',
			'https://corvmc.test/api/cron/expire-waitlisted',
			'https://corvmc.test/api/cron/wake-snoozed'
		]);
		for (const request of requests) {
			expect(request.method).toBe('POST');
			expect(request.headers.get('authorization')).toBe('Bearer test-secret');
		}
		expect(results.every((r) => r.ok)).toBe(true);
	});

	it('awaits jobs sequentially, not in parallel', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const fetcher = vi.fn(async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			inFlight--;
			return new Response('{}', { status: 200 });
		});

		await runScheduledJobs('0 16 * * *', env, fetcher);

		expect(fetcher).toHaveBeenCalledTimes(CRON_SCHEDULE['0 16 * * *'].length);
		expect(maxInFlight).toBe(1);
	});

	it('continues past a job that throws and reports the failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetcher = vi
			.fn<(request: Request) => Promise<Response>>()
			.mockRejectedValueOnce(new Error('boom'))
			.mockImplementation(async () => new Response('{}', { status: 200 }));

		const results = await runScheduledJobs('*/15 * * * *', env, fetcher);

		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(results).toEqual([
			{ path: '/api/cron/auto-complete', ok: false, error: 'boom' },
			{ path: '/api/cron/complete-shifts', ok: true, status: 200 },
			{ path: '/api/cron/cancel-unconfirmed', ok: true, status: 200 },
			{ path: '/api/cron/expire-waitlisted', ok: true, status: 200 },
			{ path: '/api/cron/wake-snoozed', ok: true, status: 200 }
		]);
	});

	it('marks non-2xx responses as failed without stopping the batch', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetcher = vi
			.fn<(request: Request) => Promise<Response>>()
			.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
			.mockImplementation(async () => new Response('{}', { status: 200 }));

		const results = await runScheduledJobs('*/15 * * * *', env, fetcher);

		expect(results.map((r) => ({ ok: r.ok, status: r.status }))).toEqual([
			{ ok: false, status: 401 },
			{ ok: true, status: 200 },
			{ ok: true, status: 200 },
			{ ok: true, status: 200 },
			{ ok: true, status: 200 }
		]);
	});

	it('brackets each job with paired in_progress → ok check-ins', async () => {
		const fetcher = okFetcher();
		let n = 0;
		const checkIn = vi.fn(async ({ status }: { status: string }) =>
			status === 'in_progress' ? `ci-${++n}` : undefined
		);

		await runScheduledJobs('*/15 * * * *', env, fetcher, checkIn);

		expect(checkIn.mock.calls.map(([opts]) => opts)).toEqual([
			{ slug: 'auto-complete', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'auto-complete', status: 'ok', checkInId: 'ci-1' },
			{ slug: 'complete-shifts', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'complete-shifts', status: 'ok', checkInId: 'ci-2' },
			{ slug: 'cancel-unconfirmed', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'cancel-unconfirmed', status: 'ok', checkInId: 'ci-3' },
			{ slug: 'expire-waitlisted', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'expire-waitlisted', status: 'ok', checkInId: 'ci-4' },
			{ slug: 'wake-snoozed', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'wake-snoozed', status: 'ok', checkInId: 'ci-5' }
		]);
	});

	it('reports error check-ins for thrown and non-2xx jobs', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetcher = vi
			.fn<(request: Request) => Promise<Response>>()
			.mockRejectedValueOnce(new Error('boom'))
			.mockImplementationOnce(async () => new Response('nope', { status: 500 }))
			.mockImplementation(async () => new Response('{}', { status: 200 }));
		const checkIn = vi.fn(async ({ status }: { status: string }) =>
			status === 'in_progress' ? 'ci-x' : undefined
		);

		await runScheduledJobs('*/15 * * * *', env, fetcher, checkIn);

		const closes = checkIn.mock.calls
			.map(([opts]) => opts as { status: string; checkInId?: string })
			.filter((o) => o.status !== 'in_progress');
		expect(closes.map((o) => o.status)).toEqual(['error', 'error', 'ok', 'ok', 'ok']);
		expect(closes.every((o) => o.checkInId === 'ci-x')).toBe(true);
	});

	// JAVASCRIPT-SVELTEKIT-21: the close must carry the id the open used, or it
	// creates a second check-in and the first times out as a phantom outage.
	it('closes with the id the opening check-in reported', async () => {
		const fetcher = okFetcher();
		const checkIn = vi.fn<CronCheckIn>(async () => 'ci-generated');

		await runScheduledJobs('*/5 * * * *', env, fetcher, checkIn);

		expect(checkIn).toHaveBeenCalledTimes(2);
		expect(checkIn.mock.calls[1][0]).toEqual({
			slug: 'send-campaigns',
			status: 'ok',
			checkInId: 'ci-generated'
		});
	});

	it('runs nothing for an unmapped cron expression', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetcher = okFetcher();

		const results = await runScheduledJobs('59 23 * * *', env, fetcher);

		expect(fetcher).not.toHaveBeenCalled();
		expect(results).toEqual([]);
	});
});
