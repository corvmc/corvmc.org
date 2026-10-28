import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reservation page's door-code retry (#1813). Codes fail together — the
 * lock offline, U-tec auth — so the button re-runs every outstanding code the
 * daily job handles, and still re-issues this booking's own code first, which
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
vi.mock('$lib/server/db', () => ({ db: { select: () => chain() } }));

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1', name: 'Staff Person' }));
vi.mock('$lib/server/authorization', () => ({
	requireCapability,
	requireUser: vi.fn()
}));

const calls: string[] = [];
const reprovisionAccessFor = vi.fn(async (row: { code?: number }) => {
	calls.push('booking');
	return { ok: true, code: row.code ?? 1234 };
});
const runDailyLockJob = vi.fn(async (_by: string | null) => {
	calls.push('job');
	return {
		provisioned: 2,
		cleaned: 0,
		confirmed: 3,
		online: true,
		fallbackActive: true,
		errors: []
	};
});
vi.mock('$lib/server/lock/lock-service', () => ({
	getLastLockJobRun: vi.fn(),
	reprovisionAccessFor,
	runDailyLockJob
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

	it('re-issues this booking with the code it already has, then every outstanding code', async () => {
		selectResults.push([confirmed]);

		const result = await retryDoorCodes('res-1');

		expect(calls).toEqual(['booking', 'job']);
		expect(reprovisionAccessFor).toHaveBeenCalledWith(expect.objectContaining({ code: 4321 }));
		expect(runDailyLockJob).toHaveBeenCalledWith('Staff Person');
		expect(result).toEqual({
			booking: { ok: true, code: 4321 },
			job: expect.objectContaining({ provisioned: 2, confirmed: 3, errors: [] })
		});
	});

	it('still runs the job when this booking could not be re-issued', async () => {
		selectResults.push([confirmed]);
		reprovisionAccessFor.mockResolvedValueOnce({ ok: false, error: 'U-tec said no' } as never);

		const result = await retryDoorCodes('res-1');

		expect(runDailyLockJob).toHaveBeenCalled();
		expect(result).toMatchObject({ booking: { ok: false, error: 'U-tec said no' } });
	});

	it('refuses a booking that is not confirmed, and touches nothing', async () => {
		selectResults.push([{ ...confirmed, status: 'scheduled' }]);

		await expect(retryDoorCodes('res-1')).rejects.toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
	});
});
