import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CRON_SCHEDULE, runScheduledJobs } from './schedule';
import type { CronCheckIn } from './sentry-check-in';

const env = { ORIGIN: 'https://corvmc.test', CRON_SECRET: 'test-secret' };

const ALL_ENDPOINTS = [
	'/api/cron/auto-complete',
	'/api/cron/cancel-stale-tickets',
	'/api/cron/cancel-unconfirmed',
	'/api/cron/expire-waitlisted',
	'/api/cron/wake-snoozed',
	'/api/cron/reminders',
	'/api/cron/generate-recurring-reservations',
	'/api/cron/lock-access',
	'/api/cron/lock-sync',
	'/api/cron/send-campaigns',
	'/api/cron/complete-shifts',
	'/api/cron/sweep-media',
	'/api/cron/schedule-radio',
	'/api/cron/sweep-audio-purchases',
	'/api/cron/sweep-incidents',
	'/api/cron/reconcile-ledger'
];

function okFetcher() {
	return vi.fn<(request: Request) => Promise<Response>>(
		async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
	);
}

function wranglerCrons(): string[] {
	const toml = readFileSync(new URL('../../../../wrangler.toml', import.meta.url), 'utf8');
	const block = /^crons\s*=\s*\[([\s\S]*?)^\]/m.exec(toml)?.[1] ?? '';
	return [...block.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** Cells of each body row of the markdown table whose header starts `| <first column>`. */
function docTable(doc: string, firstColumn: string): string[][] {
	const md = readFileSync(new URL(`../../../../docs/architecture/${doc}`, import.meta.url), 'utf8');
	const lines = md.split('\n');
	const start = lines.findIndex((l) => new RegExp(`^\\|\\s*${firstColumn}\\s*\\|`).test(l));
	const rows: string[][] = [];
	if (start === -1) return rows;
	for (const line of lines.slice(start + 2)) {
		if (!line.startsWith('|')) break;
		rows.push(line.split('|').slice(1, -1));
	}
	return rows;
}

const ticked = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('CRON_SCHEDULE', () => {
	it('has exactly the triggers wrangler.toml registers', () => {
		const crons = wranglerCrons();
		expect(crons.length).toBeGreaterThan(0);
		expect(crons.toSorted()).toEqual(Object.keys(CRON_SCHEDULE).toSorted());
	});

	// Cloudflare numbers weekdays 1 = Sunday; Sentry, which receives the same
	// string as the monitor schedule, numbers them 1 = Monday. A name means one
	// day to both (#1328).
	it.each(Object.keys(CRON_SCHEDULE))('names its weekday rather than numbering it: %s', (cron) => {
		const dayOfWeek = cron.split(/\s+/)[4];
		expect(dayOfWeek).not.toMatch(/\d/);
	});

	it('reconciles the ledger on Mondays', () => {
		expect(CRON_SCHEDULE['0 17 * * MON']).toEqual(['/api/cron/reconcile-ledger']);
	});

	it('covers every cron endpoint exactly once', () => {
		const scheduled = Object.values(CRON_SCHEDULE).flat();
		expect(scheduled.toSorted()).toEqual(ALL_ENDPOINTS.toSorted());
	});

	it('runs the daily batch in dependency order (generation before locks)', () => {
		expect(CRON_SCHEDULE['0 16 * * *']).toEqual([
			'/api/cron/generate-recurring-reservations',
			'/api/cron/lock-access',
			'/api/cron/cancel-stale-tickets',
			'/api/cron/sweep-audio-purchases',
			// Seven-year incident retention (#1468). Owns no media.
			'/api/cron/sweep-incidents',
			// Last: it reaps what every job above may have deleted, and nothing
			// downstream reads its result.
			'/api/cron/sweep-media'
		]);
	});

	it('matches the operations manual table, row for row and in order', () => {
		const rows = docTable('operations-manual.md', 'Cron \\(UTC\\)');
		expect(rows.length).toBeGreaterThan(0);
		const table = Object.fromEntries(rows.map(([cron, paths]) => [ticked(cron)[0], ticked(paths)]));
		expect(table).toEqual(CRON_SCHEDULE);
	});

	it('matches the architecture overview table, endpoint for endpoint', () => {
		const rows = docTable('overview.md', 'Endpoint');
		expect(rows.length).toBeGreaterThan(0);
		const table = rows.map(([path, , cron]) => `${ticked(cron)[0]} ${ticked(path)[0]}`);
		const schedule = Object.entries(CRON_SCHEDULE).flatMap(([cron, paths]) =>
			paths.map((path) => `${cron} ${path}`)
		);
		expect(table.toSorted()).toEqual(schedule.toSorted());
	});

	it('drains reminders after complete-shifts, which decides what is owed', () => {
		const tick = CRON_SCHEDULE['*/15 * * * *'];
		expect(tick.indexOf('/api/cron/reminders')).toBeGreaterThan(
			tick.indexOf('/api/cron/complete-shifts')
		);
	});

	// door_code_ready keys on lockSyncedAt, so the notice goes out on the same
	// tick the code is confirmed rather than fifteen minutes later (#1495).
	it('confirms door-code sync before draining reminders', () => {
		const tick = CRON_SCHEDULE['*/15 * * * *'];
		expect(tick).toContain('/api/cron/lock-sync');
		expect(tick.indexOf('/api/cron/lock-sync')).toBeLessThan(tick.indexOf('/api/cron/reminders'));
	});
});

describe('runScheduledJobs', () => {
	it('POSTs each mapped endpoint at ORIGIN with the bearer secret', async () => {
		const fetcher = okFetcher();

		const results = await runScheduledJobs('*/15 * * * *', env, fetcher);

		expect(fetcher).toHaveBeenCalledTimes(8);
		const requests = fetcher.mock.calls.map(([request]: [Request]) => request);
		expect(requests.map((r) => r.url)).toEqual([
			'https://corvmc.test/api/cron/auto-complete',
			'https://corvmc.test/api/cron/complete-shifts',
			'https://corvmc.test/api/cron/cancel-unconfirmed',
			'https://corvmc.test/api/cron/expire-waitlisted',
			'https://corvmc.test/api/cron/wake-snoozed',
			'https://corvmc.test/api/cron/lock-sync',
			'https://corvmc.test/api/cron/reminders',
			'https://corvmc.test/api/cron/schedule-radio'
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

		expect(fetcher).toHaveBeenCalledTimes(8);
		expect(results).toEqual([
			{ path: '/api/cron/auto-complete', ok: false, error: 'boom' },
			{ path: '/api/cron/complete-shifts', ok: true, status: 200 },
			{ path: '/api/cron/cancel-unconfirmed', ok: true, status: 200 },
			{ path: '/api/cron/expire-waitlisted', ok: true, status: 200 },
			{ path: '/api/cron/wake-snoozed', ok: true, status: 200 },
			{ path: '/api/cron/lock-sync', ok: true, status: 200 },
			{ path: '/api/cron/reminders', ok: true, status: 200 },
			{ path: '/api/cron/schedule-radio', ok: true, status: 200 }
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
			{ slug: 'wake-snoozed', status: 'ok', checkInId: 'ci-5' },
			{ slug: 'lock-sync', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'lock-sync', status: 'ok', checkInId: 'ci-6' },
			{ slug: 'reminders', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'reminders', status: 'ok', checkInId: 'ci-7' },
			{ slug: 'schedule-radio', status: 'in_progress', cron: '*/15 * * * *' },
			{ slug: 'schedule-radio', status: 'ok', checkInId: 'ci-8' }
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
		expect(closes.map((o) => o.status)).toEqual([
			'error',
			'error',
			'ok',
			'ok',
			'ok',
			'ok',
			'ok',
			'ok'
		]);
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
