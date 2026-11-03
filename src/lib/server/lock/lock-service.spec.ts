import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

// KV, Postmark and the U-tec lock are the outside services here.
const mockGetJson = vi.fn();
const mockPutJson = vi.fn();
vi.mock('$lib/server/kv', () => ({
	getJson: (...args: unknown[]) => mockGetJson(...args),
	putJson: (...args: unknown[]) => mockPutJson(...args)
}));

const mockDispatchEmailOnly = vi.fn();
vi.mock('$lib/server/notification', () => ({
	dispatchEmailOnly: (...args: unknown[]) => mockDispatchEmailOnly(...args)
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

// The real sibling services, wrapped so a test can see them called or make one throw.
vi.mock('./fallback-code-service', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./fallback-code-service')>();
	return { ...actual, maintainFallbackCode: vi.fn(actual.maintainFallbackCode) };
});
vi.mock('./member-code-service', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./member-code-service')>();
	return {
		...actual,
		hasActiveMemberCode: vi.fn(actual.hasActiveMemberCode),
		reconcileMemberCodeSync: vi.fn(actual.reconcileMemberCodeSync)
	};
});

const mockCreateTemporaryUser = vi.fn();
const mockAddLockUser = vi.fn();
const mockRemoveTemporaryUser = vi.fn();
const mockUpdateLockUser = vi.fn();
const mockListLockUsers = vi.fn();
const mockGetLockUser = vi.fn();
const mockQueryDeviceHealth = vi.fn();
const mockGenerateLockCode = vi.fn();

vi.mock('./ultraloc-client', () => ({
	createTemporaryUser: (...args: unknown[]) => mockCreateTemporaryUser(...args),
	addLockUser: (...args: unknown[]) => mockAddLockUser(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	updateLockUser: (...args: unknown[]) => mockUpdateLockUser(...args),
	listLockUsers: (...args: unknown[]) => mockListLockUsers(...args),
	getLockUser: (...args: unknown[]) => mockGetLockUser(...args),
	queryDeviceHealth: (...args: unknown[]) => mockQueryDeviceHealth(...args),
	generateLockCode: (...args: unknown[]) => mockGenerateLockCode(...args),
	// The real one formats in the lock's local zone; UTC keeps the strings below readable.
	lockDateTime: (d: Date) => d.toISOString().slice(0, 16).replace('T', ' '),
	LOCK_GRACE_MINUTES: 30
}));

const {
	runDailyLockJob,
	getLastLockJobRun,
	issueLockSelfTest,
	revokeLockSelfTest,
	syncAccessWindow,
	provisionOnConfirm,
	revokeAccessFor,
	reconcileUpcomingSync,
	UPCOMING_SYNC_CAP
} = await import('./lock-service');
const { maintainFallbackCode } = await import('./fallback-code-service');
const { hasActiveMemberCode, reconcileMemberCodeSync } = await import('./member-code-service');

// 2025-06-15 08:06:40 in Los Angeles — morning, and the same calendar day in UTC.
const T0 = 1_750_000_000;
const HOUR = 3600;
const DAY = 86_400;
/** Midnight that morning in club time, where the provisioning window starts. */
const TODAY = T0 - (8 * HOUR + 6 * 60 + 40);
const at = (s: number) => new Date(s * 1000);
const lockTime = (s: number) => at(s).toISOString().slice(0, 16).replace('T', ' ');

function member(id: string, name: string) {
	sqlite
		.prepare(`insert into user (id, name, email) values (?, ?, ?)`)
		.run(id, name, `${id}@example.com`);
}

function booking(
	id: string,
	cols: {
		status?: string;
		startsAt?: number;
		endsAt?: number;
		createdBy?: string;
		lockCode?: string | null;
		lockAccessId?: string | null;
		lockSyncedAt?: number | null;
	} = {}
) {
	const startsAt = cols.startsAt ?? TODAY + 19 * HOUR;
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at,
			                          lock_code, lock_access_id, lock_synced_at)
			 values (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			cols.createdBy ?? 'user-1',
			cols.createdBy ?? 'user-1',
			cols.status ?? 'confirmed',
			startsAt,
			cols.endsAt ?? startsAt + 2 * HOUR,
			cols.lockCode ?? null,
			cols.lockAccessId ?? null,
			cols.lockSyncedAt ?? null
		);
}

const lockCols = (id: string) =>
	sqlite
		.prepare(`select lock_code, lock_access_id, lock_synced_at from reservation where id = ?`)
		.get(id) as {
		lock_code: string | null;
		lock_access_id: string | null;
		lock_synced_at: number | null;
	};

const standingCode = (userId: string) =>
	sqlite
		.prepare(
			`insert into lock_member_code (id, user_id, lock_access_id, label, synced_at) values (?, ?, '50', 'Standing', ?)`
		)
		.run(`mc-${userId}`, userId, T0 - DAY);

// A temporary lock user (type 2) whose access window ended in the past.
const expiredUser = {
	id: 111,
	name: 'Alice',
	type: 2,
	daterange: ['2020-01-01 18:00', '2020-01-01 20:30'] as [string, string]
};
/** What `list` actually returns for that user: no schedule fields at all. */
const expiredRow = { id: 111, name: 'Alice', type: 2 };
// A temporary user still inside its window (far future).
const activeUser = {
	id: 222,
	name: 'Bob',
	type: 2,
	daterange: ['2999-01-01 18:00', '2999-01-01 20:30'] as [string, string]
};
const activeRow = { id: 222, name: 'Bob', type: 2 };

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(at(T0));
	for (const t of ['reservation', 'user', 'lock_member_code', 'lock_fallback_code']) {
		sqlite.exec(`delete from ${t}`);
	}
	member('user-1', 'Alice');
	member('user-2', 'Carol');
	mockCreateTemporaryUser.mockResolvedValue(null);
	mockAddLockUser.mockResolvedValue(null);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
	mockUpdateLockUser.mockResolvedValue(undefined);
	mockListLockUsers.mockResolvedValue([]);
	mockQueryDeviceHealth.mockResolvedValue({ online: true, lockState: 'Locked', batteryLevel: 4 });
	mockGetJson.mockResolvedValue(true);
	mockPutJson.mockResolvedValue(undefined);
	mockDispatchEmailOnly.mockResolvedValue(undefined);
	// `list` never carries daterange — only `get` does.
	mockGetLockUser.mockImplementation(
		async (id: number) => [expiredUser, activeUser].find((u) => u.id === id) ?? null
	);
	mockGenerateLockCode.mockReturnValue(4242);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('runDailyLockJob', () => {
	it('returns zeros when no reservations need processing', async () => {
		const result = await runDailyLockJob();

		expect(result).toMatchObject({ provisioned: 0, cleaned: 0, confirmed: 0, errors: [] });
	});

	it('provisions a door code for a confirmed reservation today', async () => {
		booking('res-1');
		mockCreateTemporaryUser.mockResolvedValue(9001);

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith({
			name: 'Alice',
			startTime: at(TODAY + 19 * HOUR),
			endTime: at(TODAY + 21 * HOUR),
			code: 4242
		});
		expect(lockCols('res-1')).toEqual({
			lock_code: '4242',
			lock_access_id: '9001',
			lock_synced_at: null
		});
	});

	it('provisions only confirmed, codeless bookings that start inside the window', async () => {
		booking('res-ok');
		booking('res-scheduled', { status: 'scheduled' });
		booking('res-has-code', { lockCode: '1111' });
		booking('res-yesterday', { startsAt: TODAY - 5 * HOUR });
		booking('res-next-week', { startsAt: TODAY + 7 * DAY });

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(mockCreateTemporaryUser).toHaveBeenCalledOnce();
		expect(lockCols('res-ok').lock_code).toBe('4242');
		expect(lockCols('res-scheduled').lock_code).toBeNull();
		expect(lockCols('res-next-week').lock_code).toBeNull();
	});

	it('deletes only expired temporary users on cleanup, and clears codes before today', async () => {
		mockListLockUsers.mockResolvedValue([expiredRow, activeRow]);
		booking('res-past', {
			startsAt: TODAY - DAY,
			lockCode: '1',
			lockAccessId: '1',
			lockSyncedAt: T0 - DAY
		});
		booking('res-today', { lockCode: '2', lockAccessId: '2', lockSyncedAt: T0 - 100 });

		const result = await runDailyLockJob();

		expect(result.cleaned).toBe(1);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledExactlyOnceWith(expiredUser.id);
		expect(lockCols('res-past')).toEqual({
			lock_code: null,
			lock_access_id: null,
			lock_synced_at: null
		});
		expect(lockCols('res-today')).toEqual({
			lock_code: '2',
			lock_access_id: '2',
			lock_synced_at: T0 - 100
		});
	});

	it('ignores non-temporary and windowless users on cleanup', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 1, name: 'Admin', type: 3 },
			// A member's persistent door code. Deleting one locks a real person out.
			{ id: 2, name: 'Normal', type: 0 },
			{ id: 3, name: 'NoRange', type: 2 } // temporary, but `get` returns no window
		]);

		const result = await runDailyLockJob();

		expect(result.cleaned).toBe(0);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
	});

	it('handles provision errors gracefully and continues', async () => {
		member('user-3', 'Bob');
		booking('res-fail', { createdBy: 'user-3' });
		booking('res-ok', { createdBy: 'user-2' });
		mockCreateTemporaryUser.mockImplementation(async ({ name }: { name: string }) => {
			if (name === 'Bob') throw new Error('API timeout');
			return null;
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(result.errors).toEqual([expect.stringContaining('res-fail')]);
		expect(lockCols('res-fail').lock_code).toBeNull();
		expect(lockCols('res-ok').lock_code).toBe('4242');
		consoleSpy.mockRestore();
	});

	it('handles cleanup deletion errors gracefully', async () => {
		mockListLockUsers.mockResolvedValue([expiredRow]);
		mockRemoveTemporaryUser.mockRejectedValueOnce(new Error('not found'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.cleaned).toBe(0);
		expect(result.errors).toEqual([expect.stringContaining('not found')]);
		consoleSpy.mockRestore();
	});
});

describe('issueLockSelfTest', () => {
	it('issues an expiring temporary code and reports both steps ok', async () => {
		mockListLockUsers.mockResolvedValue([{ id: 1, name: 'Someone', type: 2 }]);

		const result = await issueLockSelfTest();

		expect(result.ok).toBe(true);
		expect(result.code).toBe(4242);
		// A type-2 user with a real window, which expires on its own.
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith({
			name: 'CMC Self-Test',
			startTime: at(T0),
			endTime: at(T0 + 15 * 60),
			code: 4242
		});
		expect(result.expiresAt).toEqual(at(T0 + 15 * 60));
		expect(result.steps.map((s) => [s.name, s.ok])).toEqual([
			['create', true],
			['list', true]
		]);
	});

	it('reports a failed create step without throwing', async () => {
		mockCreateTemporaryUser.mockRejectedValueOnce(new Error('device offline'));

		const result = await issueLockSelfTest();

		expect(result.ok).toBe(false);
		expect(result.steps).toEqual([
			{ name: 'create', ok: false, detail: expect.stringContaining('device offline') }
		]);
		expect(mockListLockUsers).not.toHaveBeenCalled();
	});
});

describe('revokeLockSelfTest', () => {
	it('removes every user named CMC Self-Test regardless of type', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 1, name: 'CMC Self-Test', type: 2 },
			{ id: 2, name: 'CMC Self-Test', type: 0 },
			{ id: 3, name: 'A Member', type: 2 },
			{ id: 4, name: 'CMC Self-Test', type: 0 }
		]);

		const result = await revokeLockSelfTest();

		expect(result).toEqual({ removed: 3, errors: [] });
		expect(mockRemoveTemporaryUser.mock.calls.map((c) => c[0])).toEqual([1, 2, 4]);
	});
});

describe('syncAccessWindow', () => {
	const previousStart = at(TODAY + 18 * HOUR);
	const previousEnd = at(TODAY + 20 * HOUR);

	// The daily cron runs in the morning, so a booking re-timed later has been passed over.
	it('provisions a code the daily cron has already gone past', async () => {
		booking('res-1', { startsAt: TODAY + 19 * HOUR, endsAt: TODAY + 21 * HOUR });

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Alice', code: 4242 })
		);
		expect(lockCols('res-1').lock_code).toBe('4242');
	});

	it('provisions a codeless booking moved into the confirmation window', async () => {
		booking('res-1', { startsAt: TODAY + DAY + 19 * HOUR });

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(mockCreateTemporaryUser).toHaveBeenCalledOnce();
	});

	// The lock's user table is finite; a standing code already opens the door.
	it('does not mint for a member who already holds a standing code', async () => {
		booking('res-1', { startsAt: TODAY + DAY + 19 * HOUR });
		standingCode('user-1');

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
		expect(lockCols('res-1').lock_code).toBeNull();
	});

	it('leaves a codeless booking beyond the confirmation window to the cron', async () => {
		booking('res-1', { startsAt: TODAY + 10 * DAY });

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	// The lock enforces its own copy of the window, so a show pushed later would lock out at the old end.
	it('re-points the existing lock user in place when the id is known', async () => {
		booking('res-1', {
			startsAt: TODAY + 20 * HOUR,
			endsAt: TODAY + 23 * HOUR,
			lockCode: '1357',
			lockAccessId: '777',
			lockSyncedAt: T0 - 100
		});

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		// One update, no delete: the member's code never leaves the lock.
		expect(mockUpdateLockUser).toHaveBeenCalledWith(777, {
			daterange: [lockTime(TODAY + 20 * HOUR), lockTime(TODAY + 23 * HOUR + 30 * 60)]
		});
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
		// The window moved, so the code is queued again and no longer known good.
		expect(lockCols('res-1')).toEqual({
			lock_code: '1357',
			lock_access_id: '777',
			lock_synced_at: null
		});
	});

	it('falls back to delete-and-re-add for a legacy row with no lock access id', async () => {
		booking('res-1', {
			startsAt: TODAY + 20 * HOUR,
			endsAt: TODAY + 23 * HOUR,
			lockCode: '1357'
		});
		// `list` carries no windows, so the match has to go through `get`.
		mockListLockUsers.mockResolvedValue([
			{ id: 777, name: 'Alice', type: 2 },
			// Someone else's booking, same day. Must survive.
			{ id: 888, name: 'Bob', type: 2 }
		]);
		mockGetLockUser.mockImplementation(async (id: number) =>
			id === 777
				? { id: 777, name: 'Alice', type: 2, daterange: [lockTime(TODAY + 18 * HOUR), 'x'] }
				: { id: 888, name: 'Bob', type: 2, daterange: ['2999-01-01 18:00', '2999-01-01 20:30'] }
		);

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledExactlyOnceWith(777);
		// Same code: staff have already been told what it is.
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 1357,
				startTime: at(TODAY + 20 * HOUR),
				endTime: at(TODAY + 23 * HOUR)
			})
		);
		expect(mockGenerateLockCode).not.toHaveBeenCalled();
		expect(lockCols('res-1').lock_code).toBe('1357');
	});

	it('falls back to delete-and-re-add when the in-place update fails', async () => {
		booking('res-1', {
			startsAt: TODAY + 20 * HOUR,
			endsAt: TODAY + 23 * HOUR,
			lockCode: '1357',
			lockAccessId: '777'
		});
		mockUpdateLockUser.mockRejectedValueOnce(new Error('device offline'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		// A member pointed at the old window is worse than a duplicate on the lock.
		expect(result.synced).toBe(true);
		expect(result.errors[0]).toContain('re-point');
		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(expect.objectContaining({ code: 1357 }));
		consoleSpy.mockRestore();
	});

	it('does nothing when the window did not actually move', async () => {
		booking('res-1', { startsAt: TODAY + 18 * HOUR, endsAt: TODAY + 20 * HOUR, lockCode: '1357' });

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockListLockUsers).not.toHaveBeenCalled();
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	it('ignores a booking that is no longer confirmed', async () => {
		booking('res-1', { status: 'cancelled', startsAt: TODAY + 20 * HOUR, lockCode: '1357' });

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	// A duplicate window on the lock is recoverable by the daily cleanup; a locked-out member is not.
	it('re-adds access even when the stale user cannot be removed', async () => {
		booking('res-1', { startsAt: TODAY + 20 * HOUR, lockCode: '1357' });
		mockListLockUsers.mockRejectedValue(new Error('lock offline'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await syncAccessWindow('res-1', previousStart, previousEnd);

		expect(result.synced).toBe(true);
		expect(result.errors[0]).toContain('lock offline');
		expect(mockCreateTemporaryUser).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('lock health', () => {
	it('reports an offline lock as a failed run and tells staff once', async () => {
		mockQueryDeviceHealth.mockResolvedValue({
			online: false,
			lockState: 'Unlocked',
			batteryLevel: 4
		});
		mockGetJson.mockResolvedValue(true); // was online last run

		const result = await runDailyLockJob();

		expect(result.online).toBe(false);
		expect(result.errors[0]).toContain('offline');
		expect(mockDispatchEmailOnly).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'lock_offline' })
		);
		expect(mockPutJson).toHaveBeenCalledWith('ultraloc:lastSeenOnline', false);
	});

	// A week-long outage should be one email, not seven identical ones.
	it('does not re-alert while the lock stays offline', async () => {
		mockQueryDeviceHealth.mockResolvedValue({ online: false, lockState: null, batteryLevel: null });
		mockGetJson.mockResolvedValue(false); // already offline last run

		const result = await runDailyLockJob();

		expect(result.errors[0]).toContain('offline');
		expect(mockDispatchEmailOnly).not.toHaveBeenCalled();
	});

	// Not knowing is not the same as being offline.
	it('records null and provisions anyway when the health check itself fails', async () => {
		mockQueryDeviceHealth.mockRejectedValue(new Error('token expired'));
		booking('res-1');
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.online).toBeNull();
		expect(result.errors[0]).toContain('Failed to read lock health');
		expect(result.provisioned).toBe(1);
		expect(mockDispatchEmailOnly).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('sync reconciliation', () => {
	it('promotes a code to known-good only once the lock reports sync_status 1', async () => {
		booking('res-synced', { lockCode: '1', lockAccessId: '111' });
		booking('res-queued', { lockCode: '2', lockAccessId: '222' });
		mockGetLockUser.mockImplementation(async (id: number) => ({
			id,
			type: 2,
			syncStatus: id === 111 ? 1 : 0
		}));

		const result = await runDailyLockJob();

		expect(result.confirmed).toBe(1);
		expect(lockCols('res-synced').lock_synced_at).toBe(T0);
		expect(lockCols('res-queued').lock_synced_at).toBeNull();
	});

	it('reads only confirmed rows with a lock id that are not yet synced', async () => {
		booking('res-cancelled', { status: 'cancelled', lockAccessId: '1' });
		booking('res-no-id', { lockCode: '2' });
		booking('res-done', { lockCode: '3', lockAccessId: '3', lockSyncedAt: T0 - 100 });

		await runDailyLockJob();

		expect(mockGetLockUser).not.toHaveBeenCalled();
		expect(lockCols('res-done').lock_synced_at).toBe(T0 - 100);
	});

	it('leaves the code unconfirmed when the lock user has gone missing', async () => {
		booking('res-1', { lockCode: '1', lockAccessId: '999' });

		const result = await runDailyLockJob();

		expect(result.confirmed).toBe(0);
		expect(result.errors).toEqual([]);
		expect(lockCols('res-1').lock_synced_at).toBeNull();
	});
});

// The daily pass is too slow for a booking confirmed after it ran (#1495).
describe('reconcileUpcomingSync', () => {
	it('promotes codes the lock reports synced, and nothing else', async () => {
		booking('res-synced', { lockCode: '1', lockAccessId: '111' });
		booking('res-queued', { lockCode: '2', lockAccessId: '222' });
		mockGetLockUser.mockImplementation(async (id: number) => ({
			id,
			type: 2,
			syncStatus: id === 111 ? 1 : 0
		}));

		const result = await reconcileUpcomingSync();

		expect(result).toEqual({ confirmed: 1, errors: [] });
		expect(lockCols('res-synced').lock_synced_at).toBe(T0);
		expect(lockCols('res-queued').lock_synced_at).toBeNull();
		expect(mockQueryDeviceHealth).not.toHaveBeenCalled();
		expect(mockListLockUsers).not.toHaveBeenCalled();
		expect(maintainFallbackCode).not.toHaveBeenCalled();
		expect(reconcileMemberCodeSync).not.toHaveBeenCalled();
	});

	it('reads only bookings inside the confirmation window that have not ended', async () => {
		booking('res-ended', {
			startsAt: TODAY + HOUR,
			endsAt: T0 - 60,
			lockCode: '1',
			lockAccessId: '1'
		});
		booking('res-live', {
			startsAt: T0 - HOUR,
			endsAt: T0 + HOUR,
			lockCode: '2',
			lockAccessId: '2'
		});
		booking('res-later', { startsAt: TODAY + 2 * DAY, lockCode: '3', lockAccessId: '3' });
		booking('res-beyond', { startsAt: TODAY + 5 * DAY, lockCode: '4', lockAccessId: '4' });
		mockGetLockUser.mockImplementation(async (id: number) => ({ id, type: 2, syncStatus: 1 }));

		expect(await reconcileUpcomingSync()).toEqual({ confirmed: 2, errors: [] });
		expect(mockGetLockUser.mock.calls.map((c) => c[0])).toEqual([2, 3]);
	});

	it('takes the soonest bookings first, up to the cap', async () => {
		// Inserted latest-first, so insertion order is not the soonest.
		for (let i = UPCOMING_SYNC_CAP + 2; i >= 1; i--) {
			booking(`res-${i}`, { startsAt: T0 + i * 60, lockCode: String(i), lockAccessId: String(i) });
		}
		mockGetLockUser.mockImplementation(async (id: number) => ({ id, type: 2, syncStatus: 1 }));

		expect((await reconcileUpcomingSync()).confirmed).toBe(UPCOMING_SYNC_CAP);
		expect(mockGetLockUser.mock.calls.map((c) => c[0])).toEqual(
			Array.from({ length: UPCOMING_SYNC_CAP }, (_, i) => i + 1)
		);
		expect(UPCOMING_SYNC_CAP).toBeLessThanOrEqual(50);
	});

	it('reports a failed read instead of throwing', async () => {
		booking('res-1', { lockCode: '1', lockAccessId: '111' });
		mockGetLockUser.mockRejectedValue(new Error('rate limited'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await reconcileUpcomingSync();

		expect(result).toEqual({ confirmed: 0, errors: [expect.stringContaining('rate limited')] });
		consoleSpy.mockRestore();
	});

	it('leaves the daily backstop unbounded', async () => {
		for (let i = 1; i <= UPCOMING_SYNC_CAP + 2; i++) {
			booking(`res-${i}`, {
				startsAt: TODAY + 10 * DAY + i * 60,
				lockCode: String(i),
				lockAccessId: String(i)
			});
		}
		mockGetLockUser.mockImplementation(async (id: number) => ({ id, type: 2, syncStatus: 1 }));

		expect((await runDailyLockJob()).confirmed).toBe(UPCOMING_SYNC_CAP + 2);
	});
});

describe('persistent member codes', () => {
	// Every code not issued is one less user on the lock's finite table.
	it('skips provisioning for a member who already holds a standing code', async () => {
		booking('res-1', { createdBy: 'user-1' });
		booking('res-2', { createdBy: 'user-2' });
		standingCode('user-1');

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(lockCols('res-1').lock_code).toBeNull();
		expect(lockCols('res-2').lock_code).toBe('4242');
	});

	it('provisions for a member whose standing code was revoked', async () => {
		booking('res-1');
		standingCode('user-1');
		sqlite.exec(`update lock_member_code set revoked_at = ${T0 - DAY}`);

		expect((await runDailyLockJob()).provisioned).toBe(1);
	});
});

describe('provisioning window', () => {
	// A single-day window meant a lock offline that morning left an evening booking with no way in.
	it('provisions across the confirmation window, not just today', async () => {
		booking('res-in-3-days', { startsAt: T0 + 2.5 * DAY });

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(lockCols('res-in-3-days').lock_code).toBe('4242');
	});
});

// The member has their code when they confirm (#821).
describe('provisionOnConfirm', () => {
	it('mints a code for a booking confirmed inside the window', async () => {
		booking('res-1', { startsAt: T0 + DAY });

		await expect(provisionOnConfirm('res-1')).resolves.toBe(true);

		expect(mockCreateTemporaryUser).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Alice', code: 4242 })
		);
		expect(lockCols('res-1').lock_code).toBe('4242');
	});

	// A Stripe charge confirms weeks ahead; minting then would fill the lock's user table.
	it('leaves a booking beyond the window to the daily job', async () => {
		booking('res-1', { startsAt: T0 + 10 * DAY });

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	it('does not mint a second code for a booking that already has one', async () => {
		booking('res-1', { startsAt: T0 + DAY, lockCode: '1111' });

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);
		expect(lockCols('res-1').lock_code).toBe('1111');
	});

	it('ignores a booking that is not confirmed', async () => {
		booking('res-1', { startsAt: T0 + DAY, status: 'scheduled' });

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	it('skips a member who already holds a standing code', async () => {
		booking('res-1', { startsAt: T0 + DAY });
		standingCode('user-1');

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);
		expect(mockCreateTemporaryUser).not.toHaveBeenCalled();
	});

	// The member is waiting on the confirm; the daily job is the backstop.
	it('never throws when the lock API fails', async () => {
		booking('res-1', { startsAt: T0 + DAY });
		mockCreateTemporaryUser.mockRejectedValueOnce(new Error('U-tec 503'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);
		expect(lockCols('res-1').lock_code).toBeNull();
		consoleSpy.mockRestore();
	});

	it('never throws when the member-code check fails', async () => {
		booking('res-1', { startsAt: T0 + DAY });
		vi.mocked(hasActiveMemberCode).mockRejectedValueOnce(new Error('D1 unavailable'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(provisionOnConfirm('res-1')).resolves.toBe(false);
		consoleSpy.mockRestore();
	});
});

// The record staff read on the settings page (#1326).
describe('last run record', () => {
	const lastRunWrites = () =>
		mockPutJson.mock.calls.filter(([key]) => key === 'ultraloc:lastJobRun');

	it('records a clean run, attributed to the schedule when nobody triggered it', async () => {
		await runDailyLockJob();

		expect(lastRunWrites()).toEqual([
			[
				'ultraloc:lastJobRun',
				expect.objectContaining({ triggeredBy: null, errors: [], at: at(T0).toISOString() })
			]
		]);
	});

	it('names the staff member who triggered it', async () => {
		await runDailyLockJob('Jordan Martinez');

		expect(lastRunWrites()[0][1]).toMatchObject({ triggeredBy: 'Jordan Martinez' });
	});

	// The failing run is the one worth seeing.
	it('records a run that failed', async () => {
		mockQueryDeviceHealth.mockRejectedValue(new Error('Ultraloc credentials not configured'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await runDailyLockJob();

		expect((lastRunWrites()[0][1] as { errors: string[] }).errors).toContainEqual(
			expect.stringContaining('Ultraloc credentials not configured')
		);
		consoleSpy.mockRestore();
	});

	it('does not fail the run when the record cannot be written', async () => {
		mockPutJson.mockImplementation(async (key: string) => {
			if (key === 'ultraloc:lastJobRun') throw new Error('KV is down');
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(runDailyLockJob()).resolves.toMatchObject({ provisioned: 0 });
		consoleSpy.mockRestore();
	});

	it('reads the stored record back', async () => {
		const stored = { at: '2026-09-22T16:00:00.000Z', triggeredBy: null, errors: [] };
		mockGetJson.mockResolvedValue(stored);

		await expect(getLastLockJobRun()).resolves.toEqual(stored);
		expect(mockGetJson).toHaveBeenCalledWith('ultraloc:lastJobRun');
	});
});

// A throw anywhere used to abort the run before a single door code was issued (#1339).
describe('step isolation', () => {
	it('still provisions when KV is down for the health reading', async () => {
		mockGetJson.mockRejectedValue(new Error('KV is down'));
		mockPutJson.mockRejectedValue(new Error('KV is down'));
		booking('res-1');
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.provisioned).toBe(1);
		expect(result.errors).toContainEqual(expect.stringContaining('KV is down'));
		consoleSpy.mockRestore();
	});

	it('runs the later steps when an earlier one throws', async () => {
		mockListLockUsers.mockRejectedValue(new Error('lock offline'));
		vi.mocked(reconcileMemberCodeSync).mockRejectedValueOnce(new Error('D1 unavailable'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await runDailyLockJob();

		expect(result.errors).toContainEqual(expect.stringContaining('D1 unavailable'));
		// The fallback step still ran: with no code on record it minted one.
		expect(maintainFallbackCode).toHaveBeenCalledOnce();
		expect(sqlite.prepare(`select code from lock_fallback_code`).all()).toEqual([
			{ code: '42424242' }
		]);
		consoleSpy.mockRestore();
	});
});

// A cancelled booking's code stops opening the door (#1992).
describe('revokeAccessFor', () => {
	const START = Date.parse('2999-01-01T18:00:00Z') / 1000;

	it('removes the lock user by id and clears the lock columns', async () => {
		booking('res-1', {
			status: 'cancelled',
			startsAt: START,
			lockCode: '4242',
			lockAccessId: '333',
			lockSyncedAt: T0
		});
		booking('res-2', {
			status: 'cancelled',
			startsAt: START,
			lockCode: '5555',
			lockAccessId: '334'
		});

		await expect(revokeAccessFor('res-1')).resolves.toBe(true);

		expect(mockRemoveTemporaryUser).toHaveBeenCalledExactlyOnceWith(333);
		expect(lockCols('res-1')).toEqual({
			lock_code: null,
			lock_access_id: null,
			lock_synced_at: null
		});
		expect(lockCols('res-2').lock_code).toBe('5555');
	});

	// Rows provisioned before the id was recorded: match the window, as the re-time path does.
	it('finds a legacy lock user by its window and code', async () => {
		booking('res-1', { status: 'cancelled', startsAt: START, lockCode: '4242' });
		mockListLockUsers.mockResolvedValue([activeRow, { id: 444, name: 'Bob', type: 2 }]);
		mockGetLockUser.mockImplementation(async (id: number) =>
			id === 444
				? { id, name: 'Bob', type: 2, password: '4242', daterange: ['2999-01-01 18:00', 'x'] }
				: { ...activeUser, password: '9999', daterange: ['2999-01-01 18:00', 'x'] }
		);

		await expect(revokeAccessFor('res-1')).resolves.toBe(true);

		expect(mockRemoveTemporaryUser).toHaveBeenCalledExactlyOnceWith(444);
		expect(lockCols('res-1').lock_code).toBeNull();
	});

	it('leaves a confirmed booking alone', async () => {
		booking('res-1', { startsAt: START, lockCode: '4242', lockAccessId: '333' });

		await expect(revokeAccessFor('res-1')).resolves.toBe(false);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(lockCols('res-1').lock_code).toBe('4242');
	});

	it('does nothing for a booking that never had a code', async () => {
		booking('res-1', { status: 'cancelled', startsAt: START });

		await expect(revokeAccessFor('res-1')).resolves.toBe(false);
		expect(mockListLockUsers).not.toHaveBeenCalled();
	});

	// The columns are what the daily sweep retries from, so a failed delete keeps them.
	it('never throws, and keeps the columns when the lock API fails', async () => {
		booking('res-1', {
			status: 'cancelled',
			startsAt: START,
			lockCode: '4242',
			lockAccessId: '333'
		});
		mockRemoveTemporaryUser.mockRejectedValueOnce(new Error('U-tec 503'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(revokeAccessFor('res-1')).resolves.toBe(false);
		expect(lockCols('res-1')).toMatchObject({ lock_code: '4242', lock_access_id: '333' });
		consoleSpy.mockRestore();
	});
});

describe('daily sweep of cancelled bookings', () => {
	it('removes the lock user a cancelled booking still holds, and only that one', async () => {
		booking('res-9', { status: 'cancelled', lockCode: '1', lockAccessId: '555' });
		booking('res-10', { status: 'cancelled', lockAccessId: '556' });
		booking('res-live', { lockCode: '3', lockAccessId: '557', lockSyncedAt: T0 - 100 });

		const result = await runDailyLockJob();

		expect(mockRemoveTemporaryUser.mock.calls.map((c) => c[0]).sort()).toEqual([555, 556]);
		expect(result.cleaned).toBe(2);
		expect(lockCols('res-9')).toEqual({
			lock_code: null,
			lock_access_id: null,
			lock_synced_at: null
		});
		expect(lockCols('res-live').lock_code).toBe('3');
	});
});
