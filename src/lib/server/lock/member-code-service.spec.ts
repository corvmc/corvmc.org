import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;
const updateCalls: Array<Record<string, unknown>> = [];
const insertCalls: Array<Record<string, unknown>> = [];

function buildSelectChain() {
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

function buildWriteChain(record: (d: unknown) => void, key: 'set' | 'values') {
	const chain: any = new Proxy(() => chain, {
		get(_, prop) {
			if (prop === key)
				return (data: unknown) => {
					record(data);
					return chain;
				};
			if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(undefined);
			return () => chain;
		}
	});
	return chain;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => buildSelectChain(),
		update: () => buildWriteChain((d) => updateCalls.push(d as Record<string, unknown>), 'set'),
		insert: () => buildWriteChain((d) => insertCalls.push(d as Record<string, unknown>), 'values')
	}
}));

vi.mock('$lib/server/db/schema/reservation', () => ({
	lockMemberCode: {
		id: 'id',
		userId: 'user_id',
		lockAccessId: 'lock_access_id',
		code: 'code',
		label: 'label',
		syncedAt: 'synced_at',
		revokedAt: 'revoked_at'
	},
	lockFallbackCode: { lockAccessId: 'lock_access_id' }
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', name: 'name' }
}));

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn(), isNull: vi.fn() }));

const mockListLockUsers = vi.fn().mockResolvedValue([]);
const mockGetLockUser = vi.fn().mockResolvedValue(null);
const mockAddLockUser = vi.fn().mockResolvedValue(5150);
const mockRemoveTemporaryUser = vi.fn().mockResolvedValue(undefined);

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
	hasActiveMemberCode
} = await import('./member-code-service');

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	selectCallIndex = 0;
	updateCalls.length = 0;
	insertCalls.length = 0;
	mockListLockUsers.mockResolvedValue([]);
	mockGetLockUser.mockResolvedValue(null);
	mockAddLockUser.mockResolvedValue(5150);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// listUnmanagedLockUsers
// ---------------------------------------------------------------------------

describe('listUnmanagedLockUsers', () => {
	it('surfaces type-0 users no row claims, and nothing else', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 1, name: 'Steve Hunter', type: 0, syncStatus: 1 },
			{ id: 2, name: 'Elsa Wirth', type: 0, syncStatus: 1 },
			{ id: 3, name: 'Already Managed', type: 0, syncStatus: 1 },
			// Temporary reservation access — cleanup's job, not this one.
			{ id: 4, name: 'Res 12', type: 2, syncStatus: 1 },
			// The account owner.
			{ id: 5, name: 'Devon', type: 1, syncStatus: 1 },
			// The app's own service users, both type 0.
			{ id: 6, name: 'CMC Self-Test', type: 0, syncStatus: 1 },
			{ id: 7, name: 'CMC Fallback 2026-09-05', type: 0, syncStatus: 1 }
		]);
		selectResults.push([{ lockAccessId: '3' }]); // claimed
		selectResults.push([]); // fallback rows

		const result = await listUnmanagedLockUsers();

		expect(result).toEqual([
			{ lockAccessId: 1, label: 'Steve Hunter', synced: true },
			{ lockAccessId: 2, label: 'Elsa Wirth', synced: true }
		]);
	});

	it('does not surface the break-glass code once it has a row', async () => {
		mockListLockUsers.mockResolvedValue([
			{ id: 8, name: 'Some Other Name', type: 0, syncStatus: 1 }
		]);
		selectResults.push([]);
		selectResults.push([{ lockAccessId: '8' }]);

		expect(await listUnmanagedLockUsers()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// adoptLockUser
// ---------------------------------------------------------------------------

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

		expect(insertCalls[0]).toMatchObject({
			userId: 'user-1',
			lockAccessId: '1',
			code: '894056',
			adoptedAt: expect.any(Date)
		});
		expect(mockAddLockUser).not.toHaveBeenCalled();
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
	});

	it('adopts without a member when staff cannot yet say whose it is', async () => {
		mockGetLockUser.mockResolvedValue({ id: 2, name: 'Trevor', type: 0, syncStatus: 1 });

		await adoptLockUser({ lockAccessId: 2, label: 'Trevor' });

		expect(insertCalls[0]).toMatchObject({ userId: null, lockAccessId: '2' });
	});
});

// ---------------------------------------------------------------------------
// grantMemberCode / revokeMemberCode
// ---------------------------------------------------------------------------

describe('grantMemberCode', () => {
	it('adds a type-0 user and records who granted it', async () => {
		const result = await grantMemberCode({
			userId: 'user-1',
			memberName: 'Jordan Martinez',
			grantedByStaffId: 'staff-1'
		});

		expect(mockAddLockUser).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Jordan Martinez', type: 0 })
		);
		expect(result.lockAccessId).toBe(5150);
		expect(insertCalls[0]).toMatchObject({
			userId: 'user-1',
			lockAccessId: '5150',
			grantedByStaffId: 'staff-1'
		});
	});

	// A standing code with no handle could never be taken away again.
	it('refuses to record a code the lock gave no id for', async () => {
		mockAddLockUser.mockResolvedValue(null);

		await expect(
			grantMemberCode({ userId: 'u', memberName: 'A', grantedByStaffId: 's' })
		).rejects.toThrow(/did not report an id/);
		expect(insertCalls).toHaveLength(0);
	});
});

describe('revokeMemberCode', () => {
	it('deletes by lock id, not by name — names collide on the lock', async () => {
		selectResults.push([{ id: 'mc-1', lockAccessId: '777', label: 'Sebastian' }]);

		await revokeMemberCode('mc-1', 'membership ended');

		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(777);
		expect(updateCalls[0]).toMatchObject({
			revokedAt: expect.any(Date),
			revokedReason: 'membership ended'
		});
	});

	it('does nothing for a code that is already revoked', async () => {
		selectResults.push([]);

		await revokeMemberCode('mc-1', 'again');

		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(updateCalls).toHaveLength(0);
	});
});

describe('hasActiveMemberCode', () => {
	it('is true for a member holding a live standing code', async () => {
		selectResults.push([{ id: 'mc-1' }]);
		expect(await hasActiveMemberCode('user-1')).toBe(true);
	});

	it('is false when there is none', async () => {
		selectResults.push([]);
		expect(await hasActiveMemberCode('user-1')).toBe(false);
	});
});
