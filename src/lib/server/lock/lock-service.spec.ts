import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;
const updateCalls: unknown[] = [];

function buildChain() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				const result = selectResults[selectCallIndex] ?? [];
				selectCallIndex++;
				return (resolve: (v: unknown[]) => void) => resolve(result);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => buildChain(),
		update: () => {
			const chain: any = new Proxy(() => chain, {
				get(_, prop) {
					if (prop === 'set')
						return (data: unknown) => {
							updateCalls.push(data);
							return chain;
						};
					if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(undefined);
					return () => chain;
				}
			});
			return chain;
		}
	}
}));

vi.mock('$lib/server/db/schema/reservation', () => ({
	reservation: {
		id: 'id',
		status: 'status',
		startsAt: 'starts_at',
		endsAt: 'ends_at',
		createdByUserId: 'created_by_user_id',
		lockCode: 'lock_code',
		updatedAt: 'updated_at'
	}
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', name: 'name', email: 'email' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	isNull: vi.fn(),
	isNotNull: vi.fn(),
	gte: vi.fn(),
	lt: vi.fn()
}));

vi.mock('$lib/server/reservation/timezone', () => ({
	buildDateInTz: vi.fn((date, time) => new Date(`${date}T${time}:00Z`))
}));

const mockCreateTemporaryUser = vi.fn().mockResolvedValue(undefined);
const mockCreateControlUser = vi.fn().mockResolvedValue(undefined);
const mockRemoveTemporaryUser = vi.fn().mockResolvedValue(undefined);
const mockListLockUsers = vi.fn().mockResolvedValue([]);
const mockGenerateLockCode = vi.fn().mockReturnValue(4242);

vi.mock('./ultraloc-client', () => ({
	createTemporaryUser: (...args: unknown[]) => mockCreateTemporaryUser(...args),
	createControlUser: (...args: unknown[]) => mockCreateControlUser(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	listLockUsers: (...args: unknown[]) => mockListLockUsers(...args),
	generateLockCode: (...args: unknown[]) => mockGenerateLockCode(...args),
	// The real one formats in the lock's local zone; UTC is enough here, and it
	// keeps the daterange strings the matcher compares deterministic.
	lockDateTime: (d: Date) => d.toISOString().slice(0, 16).replace('T', ' '),
	LOCK_GRACE_MINUTES: 30
}));

const { runDailyLockJob, issueLockSelfTest, revokeLockSelfTest, syncAccessWindow } =
	await import('./lock-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A temporary lock user (type 2) whose access window ended in the past.
const expiredUser = {
	id: 111,
	name: 'Alice',
	type: 2,
	daterange: ['2020-01-01 18:00', '2020-01-01 20:30'] as [string, string]
};
// A temporary user still inside its window (far future).
const activeUser = {
	id: 222,
	name: 'Bob',
	type: 2,
	daterange: ['2999-01-01 18:00', '2999-01-01 20:30'] as [string, string]
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	selectCallIndex = 0;
	updateCalls.length = 0;
	mockCreateTemporaryUser.mockResolvedValue(undefined);
	mockCreateControlUser.mockResolvedValue(undefined);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
	mockListLockUsers.mockResolvedValue([]);
	mockGenerateLockCode.mockReturnValue(4242);
});

describe('runDailyLockJob', () => {
	it('returns zeros when no reservations need processing', async () => {
		// cleanup: no lock users; provision: no confirmed reservations today
		mockListLockUsers.mockResolvedValue([]);
		selectResults.push([]);

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(0);
		expect(result.cleaned).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	it('provisions a door code for confirmed reservations today', async () => {
		selectResults.push([
			{
				id: 'res-1',
				startsAt: new Date(),
				endsAt: new Date(Date.now() + 3600000),
				createdByUserId: 'user-1',
				memberName: 'Alice'
			}
		]);

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Alice', code: 4242 })
		);
		// The generated code is stored as the reservation's lockCode.
		expect(updateCalls).toContainEqual(expect.objectContaining({ lockCode: '4242' }));
	});

	it('deletes only expired temporary users on cleanup', async () => {
		mockListLockUsers.mockResolvedValue([expiredUser, activeUser]);
		selectResults.push([]); // provision: none

		const result = await runDailyLockJob();

		expect(result.cleaned).toBe(1);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledTimes(1);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(expiredUser.id);
		// Stale codes on yesterday's reservations are cleared.
		expect(updateCalls).toContainEqual(expect.objectContaining({ lockCode: null }));
	});

	it('ignores non-temporary and codeless users on cleanup', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 1, name: 'Admin', type: 3 },
			{ id: 2, name: 'Normal', type: 0 },
			{ id: 3, name: 'NoRange', type: 2 } // temporary but no daterange
		]);
		selectResults.push([]);

		const result = await runDailyLockJob();

		expect(result.cleaned).toBe(0);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
	});

	it('handles provision errors gracefully and continues', async () => {
		selectResults.push([
			{
				id: 'res-fail',
				startsAt: new Date(),
				endsAt: new Date(),
				createdByUserId: 'u1',
				memberName: 'Bob'
			},
			{
				id: 'res-ok',
				startsAt: new Date(),
				endsAt: new Date(),
				createdByUserId: 'u2',
				memberName: 'Carol'
			}
		]);

		mockCreateTemporaryUser
			.mockRejectedValueOnce(new Error('API timeout'))
			.mockResolvedValueOnce(undefined);

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('res-fail');

		consoleSpy.mockRestore();
	});

	it('handles cleanup deletion errors gracefully', async () => {
		mockListLockUsers.mockResolvedValue([expiredUser]);
		selectResults.push([]);

		mockRemoveTemporaryUser.mockRejectedValueOnce(new Error('not found'));

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.cleaned).toBe(0);
		expect(result.errors).toHaveLength(1);

		consoleSpy.mockRestore();
	});
});

describe('issueLockSelfTest', () => {
	it('issues a named control (type 0) test code and reports both steps ok', async () => {
		mockListLockUsers.mockResolvedValue([{ id: 1, name: 'Someone', type: 2 }]);

		const result = await issueLockSelfTest();

		expect(result.ok).toBe(true);
		expect(result.code).toBe(4242);
		// Uses the proven normal-user add, not the temporary-user path.
		expect(mockCreateControlUser).toHaveBeenCalledWith('CMC Self-Test', 4242);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
		expect(result.steps.map((s) => s.name)).toEqual(['create', 'list']);
		expect(result.steps.every((s) => s.ok)).toBe(true);
	});

	it('reports a failed create step without throwing', async () => {
		mockCreateControlUser.mockRejectedValueOnce(new Error('device offline'));

		const result = await issueLockSelfTest();

		expect(result.ok).toBe(false);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]).toMatchObject({ name: 'create', ok: false });
		expect(result.steps[0].detail).toContain('device offline');
		expect(mockListLockUsers).not.toHaveBeenCalled();
	});
});

describe('revokeLockSelfTest', () => {
	it('removes every user named CMC Self-Test regardless of type', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 1, name: 'CMC Self-Test', type: 2 },
			{ id: 2, name: 'CMC Self-Test', type: 0 }, // control user
			{ id: 3, name: 'A Member', type: 2 }, // not a self-test
			{ id: 4, name: 'CMC Self-Test', type: 0 }
		]);

		const result = await revokeLockSelfTest();

		expect(result.removed).toBe(3);
		expect(result.errors).toHaveLength(0);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledTimes(3);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(1);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(2);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(4);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalledWith(3);
	});
});

// ---------------------------------------------------------------------------
// syncAccessWindow — the door has to follow a booking that moved
// ---------------------------------------------------------------------------

describe('syncAccessWindow', () => {
	/**
	 * "Today" as the service computes it — the calendar day in the app's own
	 * timezone, not in UTC.
	 *
	 * Those are different dates for the seven or eight hours a day when UTC has
	 * rolled over and Los Angeles has not, and building these timestamps off the
	 * UTC day put them outside the window the service was checking. It passed
	 * every daytime run and failed at 00:04 UTC.
	 *
	 * `buildDateInTz` is mocked to `${date}T${time}:00Z`, so the boundaries the
	 * service compares against are that day string at 00:00Z and 23:59Z — which
	 * is what these have to be built on.
	 */
	function appDay(offsetDays = 0) {
		const d = new Date(Date.now() + offsetDays * 86_400_000);
		return d.toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
	}
	function todayAt(time: string) {
		return new Date(`${appDay()}T${time}:00Z`);
	}
	function tomorrowAt(time: string) {
		return new Date(`${appDay(1)}T${time}:00Z`);
	}

	const previousStart = todayAt('18:00');
	const previousEnd = todayAt('20:00');

	// The bug this exists for: the daily cron runs in the morning and only looks
	// at codeless rows starting today, so a booking re-timed in the afternoon has
	// already been passed over.
	it('provisions a code the daily cron has already gone past', async () => {
		selectResults.push([
			{
				id: 'res-1',
				status: 'confirmed',
				startsAt: todayAt('19:00'),
				endsAt: todayAt('21:00'),
				lockCode: null,
				memberName: 'Alice'
			}
		]);

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Alice', code: 4242 })
		);
		expect(updateCalls[0]).toMatchObject({ lockCode: '4242' });
	});

	it('leaves a codeless booking on another day to the cron', async () => {
		selectResults.push([
			{
				id: 'res-1',
				status: 'confirmed',
				startsAt: tomorrowAt('19:00'),
				endsAt: tomorrowAt('21:00'),
				lockCode: null,
				memberName: 'Alice'
			}
		]);

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	// The lock enforces access through its own copy of the window, so a show
	// pushed later would stop opening the door at the old end time.
	it('replaces the stale lock user, keeping the same code', async () => {
		selectResults.push([
			{
				id: 'res-1',
				status: 'confirmed',
				startsAt: todayAt('20:00'),
				endsAt: todayAt('23:00'),
				lockCode: '1357',
				memberName: 'Alice'
			}
		]);
		mockListLockUsers.mockResolvedValue([
			{
				id: 777,
				name: 'Alice',
				type: 2,
				daterange: [previousStart.toISOString().slice(0, 16).replace('T', ' '), 'x'] as [
					string,
					string
				]
			},
			// Someone else's booking, same day. Must survive.
			{ id: 888, name: 'Bob', type: 2, daterange: ['2999-01-01 18:00', '2999-01-01 20:30'] }
		]);

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(777);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalledWith(888);
		// Same code: staff have already been told what it is.
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 1357,
				startTime: todayAt('20:00'),
				endTime: todayAt('23:00')
			})
		);
		expect(mockGenerateLockCode).not.toHaveBeenCalled();
	});

	it('does nothing when the window did not actually move', async () => {
		selectResults.push([
			{
				id: 'res-1',
				status: 'confirmed',
				startsAt: previousStart,
				endsAt: previousEnd,
				lockCode: '1357',
				memberName: 'Alice'
			}
		]);

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockListLockUsers).not.toHaveBeenCalled();
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	it('ignores a booking that is no longer confirmed', async () => {
		selectResults.push([
			{
				id: 'res-1',
				status: 'cancelled',
				startsAt: todayAt('20:00'),
				endsAt: todayAt('23:00'),
				lockCode: '1357',
				memberName: 'Alice'
			}
		]);

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	// A duplicate window on the lock is recoverable by the daily cleanup; a
	// member locked out of the room is not.
	it('re-adds access even when the stale user cannot be removed', async () => {
		selectResults.push([
			{
				id: 'res-1',
				status: 'confirmed',
				startsAt: todayAt('20:00'),
				endsAt: todayAt('23:00'),
				lockCode: '1357',
				memberName: 'Alice'
			}
		]);
		mockListLockUsers.mockRejectedValue(new Error('lock offline'));

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(result.errors[0]).toContain('lock offline');
		expect(mockCreateTemporaryUser).toHaveBeenCalled();
	});
});
