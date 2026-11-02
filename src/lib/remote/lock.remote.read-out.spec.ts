import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Staff reading a door code over the phone (#2120): the booking's own code
 * from the pool, revealed, for a confirmed booking only.
 */

const selectResults: unknown[][] = [];
function chain() {
	const c: Record<string, unknown> = {
		from: () => c,
		where: () => c,
		limit: () => Promise.resolve(selectResults.shift() ?? [])
	};
	return c;
}
vi.mock('$lib/server/db', () => ({ db: { select: () => chain() } }));

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1', name: 'Staff Person' }));
vi.mock('$lib/server/authorization', () => ({ requireCapability, requireUser: vi.fn() }));

vi.mock('$lib/server/lock/lock-service', () => ({
	getLastLockJobRun: vi.fn(),
	runDailyLockJob: vi.fn()
}));

const readOutCodeFor = vi.fn(async (_id: string): Promise<string | null> => '12345678');
vi.mock('$lib/server/lock/door-service', () => ({ readOutCodeFor }));

// Kit refuses a `.remote.ts` export without the `__` marker, mock or not.
const remote =
	(type: string) =>
	(...args: unknown[]) => {
		const fn = args[args.length - 1] as { __?: unknown };
		fn.__ = { type };
		return fn;
	};
// A query is only ever refreshed from here, so it answers that and nothing else.
const query = () =>
	Object.assign(() => ({ refresh: () => Promise.resolve() }), { __: { type: 'query' } });
vi.mock('$app/server', () => ({
	command: remote('command'),
	query,
	form: remote('form')
}));

const { readOutDoorCode } = (await import('./lock.remote')) as unknown as {
	readOutDoorCode: (id: string) => Promise<{ code: string }>;
};

beforeEach(() => {
	selectResults.length = 0;
	vi.clearAllMocks();
});

describe('readOutDoorCode', () => {
	it('is lock.manage', async () => {
		selectResults.push([{ status: 'confirmed' }]);
		await readOutDoorCode('res-1');
		expect(requireCapability).toHaveBeenCalledWith('lock.manage');
	});

	it('reveals the booking’s pool code', async () => {
		selectResults.push([{ status: 'confirmed' }]);
		expect(await readOutDoorCode('res-1')).toEqual({ code: '12345678' });
		expect(readOutCodeFor).toHaveBeenCalledWith('res-1');
	});

	it('refuses a booking that is not confirmed, and claims nothing', async () => {
		selectResults.push([{ status: 'cancelled' }]);
		await expect(readOutDoorCode('res-1')).rejects.toMatchObject({ status: 400 });
		expect(readOutCodeFor).not.toHaveBeenCalled();
	});

	it('says so when the pool is empty', async () => {
		selectResults.push([{ status: 'confirmed' }]);
		readOutCodeFor.mockResolvedValueOnce(null);
		await expect(readOutDoorCode('res-1')).rejects.toMatchObject({ status: 409 });
	});
});
