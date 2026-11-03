import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

// The U-tec lock is the outside service here.
const mockListLockUsers = vi.fn();
const mockGetLockUser = vi.fn();
const mockAddLockUser = vi.fn();
const mockRemoveTemporaryUser = vi.fn();

vi.mock('./ultraloc-client', () => ({
	listLockUsers: (...args: unknown[]) => mockListLockUsers(...args),
	getLockUser: (...args: unknown[]) => mockGetLockUser(...args),
	addLockUser: (...args: unknown[]) => mockAddLockUser(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	generateLockCode: () => 4242
}));

const {
	listUnmanagedLockUsers,
	adoptLockUser,
	grantMemberCode,
	revokeMemberCode,
	listMemberCodes,
	hasActiveMemberCode,
	reconcileMemberCodeSync
} = await import('./member-code-service');

const T0 = 1_750_000_000;

function memberCode(
	id: string,
	cols: {
		userId?: string | null;
		lockAccessId?: string;
		label?: string;
		syncedAt?: number | null;
		revokedAt?: number | null;
	} = {}
) {
	sqlite
		.prepare(
			`insert into lock_member_code (id, user_id, lock_access_id, label, synced_at, revoked_at)
			 values (?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			cols.userId === undefined ? 'user-1' : cols.userId,
			cols.lockAccessId ?? '100',
			cols.label ?? `Label ${id}`,
			cols.syncedAt ?? null,
			cols.revokedAt ?? null
		);
}

const codes = () =>
	sqlite
		.prepare(
			`select id, user_id, lock_access_id, code, label, granted_by_staff_id, synced_at,
			        revoked_at, revoked_reason, adopted_at
			 from lock_member_code order by lock_access_id`
		)
		.all() as Record<string, unknown>[];

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(T0 * 1000);
	mockListLockUsers.mockResolvedValue([]);
	mockGetLockUser.mockResolvedValue(null);
	mockAddLockUser.mockResolvedValue(5150);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
	for (const t of ['lock_member_code', 'lock_fallback_code', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
});

afterEach(() => {
	vi.useRealTimers();
});

describe('listUnmanagedLockUsers', () => {
	it('surfaces type-0 users no row claims, and nothing else', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 1, name: 'Steve Hunter', type: 0, syncStatus: 1 },
			{ id: 2, name: 'Elsa Wirth', type: 0, syncStatus: 0 },
			{ id: 3, name: 'Already Managed', type: 0, syncStatus: 1 },
			// Temporary reservation access — cleanup's job, not this one.
			{ id: 4, name: 'Res 12', type: 2, syncStatus: 1 },
			// The account owner.
			{ id: 5, name: 'Devon', type: 1, syncStatus: 1 },
			// The app's own service users, both type 0.
			{ id: 6, name: 'CMC Self-Test', type: 0, syncStatus: 1 },
			{ id: 7, name: 'CMC Fallback 2026-09-05', type: 0, syncStatus: 1 }
		]);
		// A revoked row still claims its id: the lock user is the app's to clean up.
		memberCode('mc-3', { lockAccessId: '3', revokedAt: T0 });

		expect(await listUnmanagedLockUsers()).toEqual([
			{ lockAccessId: 1, label: 'Steve Hunter', synced: true },
			{ lockAccessId: 2, label: 'Elsa Wirth', synced: false }
		]);
	});

	it('does not surface the break-glass code once it has a row, whatever its name', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 8, name: 'Some Other Name', type: 0, syncStatus: 1 },
			{ id: 9, name: 'Unclaimed', type: 0, syncStatus: 1 }
		]);
		sqlite.exec(
			`insert into lock_fallback_code (id, code, lock_access_id) values ('fb-1', '1234', '8'),
			 ('fb-2', '5678', null)`
		);

		expect(await listUnmanagedLockUsers()).toEqual([
			{ lockAccessId: 9, label: 'Unclaimed', synced: true }
		]);
	});
});

describe('adoptLockUser', () => {
	it('claims the existing lock user and reads its code back, changing nothing on the lock', async () => {
		mockGetLockUser.mockResolvedValue({
			id: 1,
			name: 'Steve Hunter',
			type: 0,
			syncStatus: 1,
			password: '894056'
		});

		await adoptLockUser({ lockAccessId: 1, label: 'Steve Hunter', userId: 'user-1' });

		expect(codes()).toEqual([
			expect.objectContaining({
				user_id: 'user-1',
				lock_access_id: '1',
				code: '894056',
				label: 'Steve Hunter',
				adopted_at: T0,
				synced_at: T0
			})
		]);
		expect(mockAddLockUser).not.toHaveBeenCalled();
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
	});

	it('adopts without a member when staff cannot yet say whose it is', async () => {
		mockGetLockUser.mockResolvedValue({ id: 2, name: 'Trevor', type: 0, syncStatus: 0 });

		await adoptLockUser({ lockAccessId: 2, label: 'Trevor' });

		expect(codes()).toEqual([
			expect.objectContaining({ user_id: null, lock_access_id: '2', code: null, synced_at: null })
		]);
	});
});

describe('grantMemberCode', () => {
	it('adds a type-0 user and records who granted it', async () => {
		const result = await grantMemberCode({
			userId: 'user-1',
			memberName: 'Jordan Martinez',
			grantedByStaffId: 'staff-1'
		});

		expect(mockAddLockUser).toHaveBeenCalledWith({
			name: 'Jordan Martinez',
			type: 0,
			password: 42424242
		});
		expect(result).toEqual({ code: 42424242, lockAccessId: 5150 });
		expect(codes()).toEqual([
			expect.objectContaining({
				user_id: 'user-1',
				lock_access_id: '5150',
				code: '42424242',
				label: 'Jordan Martinez',
				granted_by_staff_id: 'staff-1',
				synced_at: null
			})
		]);
	});

	// A standing code with no handle could never be taken away again.
	it('refuses to record a code the lock gave no id for', async () => {
		mockAddLockUser.mockResolvedValue(null);

		await expect(
			grantMemberCode({ userId: 'u', memberName: 'A', grantedByStaffId: 's' })
		).rejects.toThrow(/did not report an id/);
		expect(codes()).toEqual([]);
	});
});

describe('revokeMemberCode', () => {
	it('deletes by lock id, not by name — names collide on the lock', async () => {
		memberCode('mc-1', { lockAccessId: '777', label: 'Sebastian' });
		memberCode('mc-2', { lockAccessId: '778', label: 'Sebastian' });

		await revokeMemberCode('mc-1', 'membership ended');

		expect(mockRemoveTemporaryUser).toHaveBeenCalledExactlyOnceWith(777);
		expect(codes().map((c) => [c.id, c.revoked_at, c.revoked_reason])).toEqual([
			['mc-1', T0, 'membership ended'],
			['mc-2', null, null]
		]);
	});

	it('does nothing for a code that is already revoked', async () => {
		memberCode('mc-1', { revokedAt: T0 - 100 });
		sqlite.exec(`update lock_member_code set revoked_reason = 'first' where id = 'mc-1'`);

		await revokeMemberCode('mc-1', 'again');

		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(codes()[0]).toMatchObject({ revoked_at: T0 - 100, revoked_reason: 'first' });
	});
});

describe('listMemberCodes', () => {
	it('lists live codes with the member each belongs to', async () => {
		sqlite.exec(`insert into user (id, name, email) values ('user-1', 'Jordan', 'j@example.com')`);
		memberCode('mc-1', { lockAccessId: '1' });
		memberCode('mc-2', { lockAccessId: '2', userId: null });
		memberCode('mc-3', { lockAccessId: '3', revokedAt: T0 });

		const rows = await listMemberCodes();

		expect(rows.map((r) => [r.id, r.memberName]).sort()).toEqual([
			['mc-1', 'Jordan'],
			['mc-2', null]
		]);
	});
});

describe('hasActiveMemberCode', () => {
	it('is true for a member holding a live standing code', async () => {
		memberCode('mc-1');
		expect(await hasActiveMemberCode('user-1')).toBe(true);
	});

	it("is false for a revoked code or another member's code", async () => {
		memberCode('mc-1', { revokedAt: T0 });
		memberCode('mc-2', { userId: 'user-2', lockAccessId: '200' });
		expect(await hasActiveMemberCode('user-1')).toBe(false);
	});
});

describe('reconcileMemberCodeSync', () => {
	it('marks synced only the live, unsynced codes the lock reports as synced', async () => {
		memberCode('mc-synced-now', { lockAccessId: '1' });
		memberCode('mc-still-queued', { lockAccessId: '2' });
		memberCode('mc-already', { lockAccessId: '3', syncedAt: T0 - 100 });
		memberCode('mc-revoked', { lockAccessId: '4', revokedAt: T0 - 100 });
		mockGetLockUser.mockImplementation(async (id: number) => ({
			id,
			syncStatus: id === 2 ? 0 : 1
		}));
		const errors: string[] = [];

		expect(await reconcileMemberCodeSync(errors)).toBe(1);

		expect(mockGetLockUser.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
		expect(codes().map((c) => [c.id, c.synced_at])).toEqual([
			['mc-synced-now', T0],
			['mc-still-queued', null],
			['mc-already', T0 - 100],
			['mc-revoked', null]
		]);
		expect(errors).toEqual([]);
	});

	it('records a lock failure and carries on with the next code', async () => {
		memberCode('mc-1', { lockAccessId: '1' });
		memberCode('mc-2', { lockAccessId: '2' });
		mockGetLockUser.mockImplementation(async (id: number) => {
			if (id === 1) throw new Error('lock offline');
			return { id, syncStatus: 1 };
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const errors: string[] = [];

		expect(await reconcileMemberCodeSync(errors)).toBe(1);

		expect(errors).toEqual([expect.stringContaining('mc-1')]);
		expect(codes().map((c) => [c.id, c.synced_at])).toEqual([
			['mc-1', null],
			['mc-2', T0]
		]);
		consoleSpy.mockRestore();
	});
});
