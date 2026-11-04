import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

// The U-tec lock is the outside service here.
const mockAddLockUser = vi.fn();
const mockGetLockUser = vi.fn();
const mockRemoveTemporaryUser = vi.fn();

vi.mock('./ultraloc-client', () => ({
	addLockUser: (...args: unknown[]) => mockAddLockUser(...args),
	getLockUser: (...args: unknown[]) => mockGetLockUser(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	generateLockCode: () => 4242,
	LOCK_GRACE_MINUTES: 30
}));

const {
	maintainFallbackCode,
	rotateFallbackCodeNow,
	revealFallbackCodeFor,
	fallbackShownFor,
	FALLBACK_ROTATION_DAYS
} = await import('./fallback-code-service');

const T0 = 1_750_000_000;
const DAY = 86_400;
const NOW = new Date(T0 * 1000);
const at = (offsetSeconds: number) => new Date((T0 + offsetSeconds) * 1000);

function fallback(
	id: string,
	cols: {
		code?: string;
		lockAccessId?: string | null;
		syncedAt?: number | null;
		retiredAt?: number | null;
		createdAt?: number;
	} = {}
) {
	sqlite
		.prepare(
			`insert into lock_fallback_code (id, code, lock_access_id, synced_at, retired_at, created_at)
			 values (?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			cols.code ?? `code-${id}`,
			cols.lockAccessId === undefined ? '1' : cols.lockAccessId,
			cols.syncedAt ?? null,
			cols.retiredAt ?? null,
			cols.createdAt ?? T0 - DAY
		);
}

const fallbacks = () =>
	sqlite
		.prepare(
			`select id, code, lock_access_id, synced_at, retired_at from lock_fallback_code order by created_at, id`
		)
		.all() as Record<string, unknown>[];

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	mockAddLockUser.mockResolvedValue(9001);
	mockGetLockUser.mockResolvedValue(null);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
	sqlite.exec(`delete from lock_fallback_code`);
	sqlite.exec(`delete from reservation`);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('maintainFallbackCode', () => {
	it('mints a break-glass code when there is none at all', async () => {
		const errors: string[] = [];
		const result = await maintainFallbackCode(errors);

		expect(mockAddLockUser).toHaveBeenCalledWith({
			name: 'CMC Fallback 2025-06-15',
			type: 0,
			password: 42424242
		});
		expect(fallbacks()).toEqual([
			expect.objectContaining({
				code: '42424242',
				lock_access_id: '9001',
				synced_at: null,
				retired_at: null
			})
		]);
		// Not usable until the lock confirms it.
		expect(result).toEqual({ active: null, rotated: false });
		expect(errors).toEqual([]);
	});

	it('leaves a current confirmed code alone', async () => {
		fallback('f1', { code: '87654321', syncedAt: T0 - 2 * DAY });

		const result = await maintainFallbackCode([]);

		expect(mockAddLockUser).not.toHaveBeenCalled();
		expect(result).toEqual({ active: '87654321', rotated: false });
	});

	it('ignores a retired code when deciding whether one is in service', async () => {
		fallback('f0', { code: '00000000', syncedAt: T0 - 2 * DAY, retiredAt: T0 - DAY });

		const result = await maintainFallbackCode([]);

		expect(mockAddLockUser).toHaveBeenCalledOnce();
		expect(result.active).toBeNull();
	});

	it('mints a successor once the incumbent is past the rotation period', async () => {
		fallback('f1', { code: '11112222', syncedAt: T0 - (FALLBACK_ROTATION_DAYS + 1) * DAY });

		const result = await maintainFallbackCode([]);

		expect(mockAddLockUser).toHaveBeenCalledOnce();
		// The incumbent stays live until the successor confirms.
		expect(result.active).toBe('11112222');
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(fallbacks()[0]).toMatchObject({ id: 'f1', retired_at: null });
	});

	// The whole point of the design: never a gap with no working code.
	it('promotes a synced successor and only then retires the code it replaces', async () => {
		fallback('f1', { code: '11112222', lockAccessId: '111', syncedAt: T0 - 40 * DAY });
		fallback('f2', { code: '33334444', lockAccessId: '222', createdAt: T0 - 100 });
		mockGetLockUser.mockResolvedValue({ id: 222, type: 0, syncStatus: 1 });

		const result = await maintainFallbackCode([]);

		expect(mockGetLockUser).toHaveBeenCalledWith(222);
		expect(result).toEqual({ active: '33334444', rotated: true });
		expect(fallbacks().map((f) => [f.id, f.synced_at, f.retired_at])).toEqual([
			['f1', T0 - 40 * DAY, T0],
			['f2', T0, null]
		]);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledExactlyOnceWith(111);
		expect(mockAddLockUser).not.toHaveBeenCalled();
	});

	it('does not promote a successor the lock has not confirmed', async () => {
		fallback('f1', { code: '1111', lockAccessId: '111', syncedAt: T0 - 2 * DAY });
		fallback('f2', { code: '3333', lockAccessId: '222', createdAt: T0 - 100 });
		mockGetLockUser.mockResolvedValue({ id: 222, type: 0, syncStatus: 0 });

		const result = await maintainFallbackCode([]);

		expect(result).toEqual({ active: '1111', rotated: false });
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(fallbacks().map((f) => [f.id, f.synced_at, f.retired_at])).toEqual([
			['f1', T0 - 2 * DAY, null],
			['f2', null, null]
		]);
	});

	// Otherwise every daily run during an outage adds another dead lock user.
	it('does not mint a second successor while one is already in flight', async () => {
		fallback('f2', { lockAccessId: '222' });
		mockGetLockUser.mockResolvedValue({ id: 222, type: 0, syncStatus: 0 });

		await maintainFallbackCode([]);

		expect(mockAddLockUser).not.toHaveBeenCalled();
		expect(fallbacks()).toHaveLength(1);
	});

	it('drops a pending row with no lock id and mints again', async () => {
		fallback('f-lost', { lockAccessId: null });

		await maintainFallbackCode([]);

		expect(mockGetLockUser).not.toHaveBeenCalled();
		expect(fallbacks()).toEqual([expect.objectContaining({ lock_access_id: '9001' })]);
	});

	it('records a failed mint without throwing', async () => {
		mockAddLockUser.mockRejectedValue(new Error('lock offline'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const errors: string[] = [];

		expect(await maintainFallbackCode(errors)).toEqual({ active: null, rotated: false });

		expect(errors).toEqual([expect.stringContaining('lock offline')]);
		expect(fallbacks()).toEqual([]);
		consoleSpy.mockRestore();
	});
});

describe('rotateFallbackCodeNow', () => {
	it('mints a successor while the incumbent stays live', async () => {
		fallback('f1', { code: '11112222', syncedAt: T0 - 2 * DAY });

		expect(await rotateFallbackCodeNow()).toEqual({ ok: true });
		expect(fallbacks()).toEqual([
			expect.objectContaining({ id: 'f1', retired_at: null }),
			expect.objectContaining({ code: '42424242', synced_at: null })
		]);
	});

	it('refuses while a successor is already waiting on the lock', async () => {
		fallback('f2');

		expect(await rotateFallbackCodeNow()).toMatchObject({ ok: false });
		expect(mockAddLockUser).not.toHaveBeenCalled();
	});
});

function booking(id: string) {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 values (?, 'user', 'u1', 'u1', 'confirmed', ?, ?)`
		)
		.run(id, T0 - 600, T0 + 3600);
}

const revealedAt = (id: string) =>
	(
		sqlite
			.prepare(`select lock_fallback_revealed_at as v from reservation where id = ?`)
			.get(id) as {
			v: number | null;
		}
	).v;

describe('revealFallbackCodeFor', () => {
	const inWindow = {
		id: 'res-1',
		status: 'confirmed',
		startsAt: at(-600),
		endsAt: at(3600),
		lockSyncedAt: null
	};

	beforeEach(() => {
		booking('res-1');
		booking('res-2');
	});

	it('hands over the active code and stamps only this booking', async () => {
		fallback('f1', { code: '87654321', syncedAt: T0 - DAY });
		fallback('f2', { code: 'pending-one' });

		expect(await revealFallbackCodeFor(inWindow)).toBe('87654321');
		expect(revealedAt('res-1')).toBe(T0);
		expect(revealedAt('res-2')).toBeNull();
	});

	it('does not reveal it to a member whose own code is known good', async () => {
		fallback('f1', { syncedAt: T0 - DAY });

		expect(await revealFallbackCodeFor({ ...inWindow, lockSyncedAt: NOW })).toBeNull();
		expect(revealedAt('res-1')).toBeNull();
	});

	it('does not reveal it outside the access window', async () => {
		fallback('f1', { syncedAt: T0 - DAY });

		expect(
			await revealFallbackCodeFor({
				...inWindow,
				startsAt: at(7 * DAY),
				endsAt: at(7 * DAY + 3600)
			})
		).toBeNull();
	});

	it('does not reveal it for an unconfirmed reservation', async () => {
		fallback('f1', { syncedAt: T0 - DAY });

		expect(await revealFallbackCodeFor({ ...inWindow, status: 'scheduled' })).toBeNull();
	});

	it('returns null rather than inventing one when no code is active', async () => {
		fallback('f0', { syncedAt: T0 - 2 * DAY, retiredAt: T0 - DAY });
		fallback('f1');

		expect(await revealFallbackCodeFor(inWindow)).toBeNull();
		expect(revealedAt('res-1')).toBeNull();
	});
});

// The staff read of the same rule (#1814).
describe('fallbackShownFor', () => {
	const inWindow = {
		status: 'confirmed',
		startsAt: at(-600),
		endsAt: at(3600),
		lockSyncedAt: null
	};

	beforeEach(() => {
		booking('res-1');
	});

	it('shows staff the code the member is shown, without recording a reveal', async () => {
		fallback('f1', { code: '87654321', syncedAt: T0 - DAY });

		expect(await fallbackShownFor(inWindow)).toEqual({ code: '87654321', showsFrom: null });
		expect(revealedAt('res-1')).toBeNull();
	});

	it('says when it will be shown for a booking whose window has not opened', async () => {
		const later = { ...inWindow, startsAt: at(7 * DAY), endsAt: at(7 * DAY + 3600) };

		expect(await fallbackShownFor(later)).toEqual({
			code: null,
			showsFrom: at(7 * DAY - 30 * 60)
		});
	});

	it('is null when the member is shown their own code', async () => {
		expect(await fallbackShownFor({ ...inWindow, lockSyncedAt: NOW })).toBeNull();
	});

	it('is null once the window has closed', async () => {
		expect(
			await fallbackShownFor({ ...inWindow, startsAt: at(-5 * 3600), endsAt: at(-4 * 3600) })
		).toBeNull();
	});

	it('is null for a booking that is not confirmed', async () => {
		expect(await fallbackShownFor({ ...inWindow, status: 'scheduled' })).toBeNull();
	});
});
