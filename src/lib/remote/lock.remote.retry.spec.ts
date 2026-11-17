import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reservation page's door-code retry (#1813). Codes fail together — the
 * lock offline, U-tec auth — so the button queues the daily job for every
 * outstanding code, and still re-issues this booking's own code first, which
 * the job would skip once it has one or when it is outside the window.
 */

const selectResults: unknown[][] = [];
function chain() {
	const c: Record<string, unknown> = {
		from: () => c,
		where: () => c,
		innerJoin: () => c,
		limit: () => Promise.resolve(selectResults.shift() ?? [])
	};
	return c;
}
vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => chain() } }));

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1', name: 'Staff Person' }));
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability,
	requireUser: vi.fn()
}));

const calls: string[] = [];
const reprovisionAccessFor = vi.fn(async (row: { code?: number }) => {
	calls.push('booking');
	return { ok: true, code: row.code ?? 1234 };
});
// The job runs past 40 s, so the retry queues it for the cron rather than
// holding the request open.
const requestLockJobRun = vi.fn(async (by: string | null) => {
	calls.push('job');
	return { at: '2026-11-16T10:00:00.000Z', requestedBy: by };
});
vi.mock('#lib/server/lock/lock-service.js', () => ({
	getLastLockJobRun: vi.fn(),
	reprovisionAccessFor
}));
vi.mock('#lib/server/lock/lock-job-request.js', () => ({
	getLockJobRequest: vi.fn(),
	requestLockJobRun
}));

// Kit refuses a `.remote.ts` export without the `__` marker, mock or not.
const remote =
	(type: string) =>
	(...args: unknown[]) => {
		const fn = args[args.length - 1] as { __?: unknown };
		fn.__ = { type };
		return fn;
	};
vi.mock('$app/server', () => ({
	command: remote('command'),
	query: remote('query'),
	form: remote('form')
}));

const { retryDoorCodes } = (await import('./lock.remote')) as unknown as {
	retryDoorCodes: (id: string) => Promise<unknown>;
};

const confirmed = {
	id: 'res-1',
	status: 'confirmed',
	startsAt: new Date('2026-11-01T19:00:00Z'),
	endsAt: new Date('2026-11-01T21:00:00Z'),
	lockCode: '4321',
	memberName: 'Jane Doe'
};

beforeEach(() => {
	selectResults.length = 0;
	calls.length = 0;
	vi.clearAllMocks();
});

describe('retryDoorCodes', () => {
	it('is lock.manage', async () => {
		selectResults.push([confirmed]);
		await retryDoorCodes('res-1');
		expect(requireCapability).toHaveBeenCalledWith('lock.manage');
	});

	it('re-issues this booking with the code it already has, then queues the job', async () => {
		selectResults.push([confirmed]);

		const result = await retryDoorCodes('res-1');

		expect(calls).toEqual(['booking', 'job']);
		expect(reprovisionAccessFor).toHaveBeenCalledWith(expect.objectContaining({ code: 4321 }));
		expect(requestLockJobRun).toHaveBeenCalledWith('Staff Person');
		expect(result).toEqual({
			booking: { ok: true, code: 4321 },
			job: expect.objectContaining({ requestedBy: 'Staff Person' })
		});
	});

	it('still queues the job when this booking could not be re-issued', async () => {
		selectResults.push([confirmed]);
		reprovisionAccessFor.mockResolvedValueOnce({ ok: false, error: 'U-tec said no' } as never);

		const result = await retryDoorCodes('res-1');

		expect(requestLockJobRun).toHaveBeenCalled();
		expect(result).toMatchObject({ booking: { ok: false, error: 'U-tec said no' } });
	});

	it('refuses a booking that is not confirmed, and touches nothing', async () => {
		selectResults.push([{ ...confirmed, status: 'waitlisted' }]);

		await expect(retryDoorCodes('res-1')).rejects.toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
	});
});
