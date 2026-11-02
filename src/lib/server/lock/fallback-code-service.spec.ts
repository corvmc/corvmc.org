import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The pool's claims and job stage against a real SQLite; the lock is mocked. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const kv = new Map<string, unknown>();
vi.mock('$lib/server/kv', () => ({
	getJson: async (key: string) => kv.get(key) ?? null,
	putJson: async (key: string, value: unknown) => void kv.set(key, value)
}));

const mockDispatchEmailOnly = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/notification', () => ({
	dispatchEmailOnly: (...args: unknown[]) => mockDispatchEmailOnly(...args)
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const mockAddLockUser = vi.fn();
const mockGetLockUser = vi.fn();
const mockListLockUsers = vi.fn();
const mockRemoveTemporaryUser = vi.fn();

vi.mock('./ultraloc-client', () => ({
	addLockUser: (...args: unknown[]) => mockAddLockUser(...args),
	getLockUser: (...args: unknown[]) => mockGetLockUser(...args),
	listLockUsers: (...args: unknown[]) => mockListLockUsers(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	generateLockCode: () => 4242,
	LOCK_GRACE_MINUTES: 30
}));

const {
	claimPoolCode,
	revealPoolCode,
	revealFallbackCodeFor,
	maintainCodePool,
	listPoolCodes,
	poolDepth
} = await import('./fallback-code-service');
const { DOOR_CODE_POOL_SIZE } = await import('$lib/config');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-11-02T20:00:00Z');
const s = (d: Date) => Math.floor(d.getTime() / 1000);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

function booking(id: string, startsAt: Date, endsAt: Date, status = 'confirmed') {
	sqlite
		.prepare(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at)
			 values (?, 'user', 'u-1', 'u-1', ?, ?, ?)`
		)
		.run(id, status, s(startsAt), s(endsAt));
}

let seq = 0;
function code(
	fields: Partial<{
		lockAccessId: string | null;
		synced: boolean;
		pooled: boolean;
		claimedBy: string;
		revealed: boolean;
		retired: boolean;
	}> = {}
): string {
	const id = `code-${++seq}`;
	sqlite
		.prepare(
			`insert into lock_fallback_code
			 (id, code, lock_access_id, synced_at, pooled, claimed_by_reservation_id, claimed_at, revealed_at, retired_at, created_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			String(10_000_000 + seq),
			fields.lockAccessId === undefined ? String(500 + seq) : fields.lockAccessId,
			fields.synced === false ? null : s(hours(-48)) + seq,
			fields.pooled === false ? 0 : 1,
			fields.claimedBy ?? null,
			fields.claimedBy ? s(hours(-3)) : null,
			fields.revealed ? s(hours(-3)) : null,
			fields.retired ? s(hours(-100)) : null,
			s(hours(-72)) + seq
		);
	return id;
}

const row = (id: string) =>
	sqlite.prepare('select * from lock_fallback_code where id = ?').get(id) as Record<
		string,
		unknown
	>;

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec('delete from lock_fallback_code');
	sqlite.exec('delete from reservation');
	kv.clear();
	seq = 0;
	let nextId = 9000;
	mockAddLockUser.mockImplementation(async () => ++nextId);
	mockGetLockUser.mockResolvedValue(null);
	mockListLockUsers.mockResolvedValue([]);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

describe('claimPoolCode', () => {
	it('claims the longest-synced available code, and keeps it for the booking', async () => {
		booking('r-1', hours(0), hours(2));
		const oldest = code();
		code();

		const first = await claimPoolCode('r-1', NOW);
		const again = await claimPoolCode('r-1', NOW);

		expect(first?.id).toBe(oldest);
		expect(again?.id).toBe(oldest);
		expect(row(oldest).claimed_by_reservation_id).toBe('r-1');
	});

	it('gives another booking a different code', async () => {
		booking('r-1', hours(0), hours(2));
		booking('r-2', hours(0), hours(2));
		code();
		code();

		const a = await claimPoolCode('r-1', NOW);
		const b = await claimPoolCode('r-2', NOW);

		expect(a?.id).not.toBe(b?.id);
	});

	it('skips unsynced, revealed and legacy codes', async () => {
		booking('r-1', hours(0), hours(2));
		code({ synced: false });
		code({ pooled: false });
		code({ revealed: true });

		expect(await claimPoolCode('r-1', NOW)).toBeNull();
	});

	it('alerts staff once a day when the pool is empty', async () => {
		booking('r-1', hours(0), hours(2));

		await claimPoolCode('r-1', NOW);
		await claimPoolCode('r-1', NOW);

		expect(mockDispatchEmailOnly).toHaveBeenCalledTimes(1);
		expect(mockDispatchEmailOnly.mock.calls[0][0]).toMatchObject({ type: 'lock_pool_empty' });
	});

	it('refuses a second live code for one booking at the database', () => {
		booking('r-1', hours(0), hours(2));
		code({ claimedBy: 'r-1' });
		expect(() => code({ claimedBy: 'r-1' })).toThrow(/UNIQUE/);
	});
});

describe('revealPoolCode', () => {
	it('stamps the reveal once', async () => {
		booking('r-1', hours(0), hours(2));
		const id = code();

		await revealPoolCode('r-1', NOW);
		const later = new Date(NOW.getTime() + 60_000);
		await revealPoolCode('r-1', later);

		expect(row(id).revealed_at).toBe(s(NOW));
	});
});

describe('revealFallbackCodeFor', () => {
	it('reveals a pool code inside the window when the booking’s own code is not on the lock', async () => {
		const startsAt = new Date(Date.now() - 600_000);
		const endsAt = new Date(Date.now() + 3_600_000);
		booking('r-1', startsAt, endsAt);
		const id = code();

		const shown = await revealFallbackCodeFor({
			id: 'r-1',
			status: 'confirmed',
			startsAt,
			endsAt,
			lockSyncedAt: null
		});

		expect(shown).toBe(row(id).code);
		expect(row(id).revealed_at).not.toBeNull();
	});

	it('claims nothing outside the window', async () => {
		const startsAt = new Date(Date.now() + 7 * 86_400_000);
		booking('r-1', startsAt, new Date(startsAt.getTime() + 3_600_000));
		const id = code();

		const shown = await revealFallbackCodeFor({
			id: 'r-1',
			status: 'confirmed',
			startsAt,
			endsAt: new Date(startsAt.getTime() + 3_600_000),
			lockSyncedAt: null
		});

		expect(shown).toBeNull();
		expect(row(id).claimed_by_reservation_id).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// The job stage
// ---------------------------------------------------------------------------

/** Fill the pool to depth so a test's refill mints nothing it did not ask for. */
function fillPool(n = DOOR_CODE_POOL_SIZE) {
	for (let i = 0; i < n; i++) code();
}

describe('maintainCodePool', () => {
	it('confirms a minted code once the lock reports it synced', async () => {
		fillPool(DOOR_CODE_POOL_SIZE - 1);
		const pending = code({ synced: false });
		mockGetLockUser.mockResolvedValue({ id: 1, syncStatus: 1 });

		const result = await maintainCodePool([], NOW);

		expect(result.confirmed).toBe(1);
		expect(row(pending).synced_at).not.toBeNull();
	});

	it('drops a minted code whose lock id was never recovered, and mints a replacement', async () => {
		fillPool(DOOR_CODE_POOL_SIZE - 1);
		const orphan = code({ synced: false, lockAccessId: null });

		const result = await maintainCodePool([], NOW);

		expect(row(orphan)).toBeUndefined();
		expect(result.minted).toBe(1);
	});

	it('returns an unrevealed claim to the pool once the booking is over', async () => {
		fillPool();
		booking('over', hours(-4), hours(-2));
		booking('live', hours(-1), hours(1));
		const overCode = code({ claimedBy: 'over' });
		const liveCode = code({ claimedBy: 'live' });

		const result = await maintainCodePool([], NOW);

		expect(result.released).toBe(1);
		expect(row(overCode).claimed_by_reservation_id).toBeNull();
		expect(row(liveCode).claimed_by_reservation_id).toBe('live');
	});

	it('releases the claim of a cancelled booking straight away', async () => {
		fillPool();
		booking('gone', hours(2), hours(4), 'cancelled');
		const id = code({ claimedBy: 'gone' });

		await maintainCodePool([], NOW);

		expect(row(id).claimed_by_reservation_id).toBeNull();
	});

	it('keeps a revealed code through the grace after the booking ends', async () => {
		fillPool();
		booking('just-ended', hours(-2), new Date(NOW.getTime() - 10 * 60_000));
		const id = code({ claimedBy: 'just-ended', revealed: true });
		mockListLockUsers.mockResolvedValue([{ id: Number(row(id).lock_access_id), syncStatus: 1 }]);

		await maintainCodePool([], NOW);

		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(row(id).removed_at).toBeNull();
	});

	it('sends a delete for a revealed code whose booking is over, and waits for the lock', async () => {
		fillPool();
		booking('over', hours(-4), hours(-2));
		const id = code({ claimedBy: 'over', revealed: true });
		const lockId = Number(row(id).lock_access_id);
		mockListLockUsers.mockResolvedValue([{ id: lockId, syncStatus: 1 }]);

		const result = await maintainCodePool([], NOW);

		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(lockId);
		expect(result.awaitingRemoval).toBe(1);
		expect(row(id).removed_at).toBeNull();
		expect(row(id).claimed_by_reservation_id).toBe('over');
	});

	it('does not resend a delete while the lock still has one pending', async () => {
		fillPool();
		booking('over', hours(-4), hours(-2));
		const id = code({ claimedBy: 'over', revealed: true });
		mockListLockUsers.mockResolvedValue([{ id: Number(row(id).lock_access_id), syncStatus: 0 }]);

		await maintainCodePool([], NOW);

		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
	});

	it('marks a burned code removed once it is gone from the lock', async () => {
		fillPool();
		booking('over', hours(-4), hours(-2));
		const id = code({ claimedBy: 'over', revealed: true });

		const result = await maintainCodePool([], NOW);

		expect(result.burned).toBe(1);
		expect(row(id).removed_at).toBe(s(NOW));
	});

	it('burns the pre-pool break-glass code only once the pool has a code to offer', async () => {
		const legacy = code({ pooled: false });
		mockListLockUsers.mockResolvedValue([
			{ id: Number(row(legacy).lock_access_id), syncStatus: 1 }
		]);
		mockAddLockUser.mockRejectedValue(new Error('offline'));

		await maintainCodePool([], NOW);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();

		code();
		await maintainCodePool([], NOW);
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(Number(row(legacy).lock_access_id));
	});

	it('leaves a break-glass code a successor already retired alone', async () => {
		fillPool();
		code({ pooled: false, retired: true });

		await maintainCodePool([], NOW);

		expect(mockListLockUsers).not.toHaveBeenCalled();
	});

	it('mints up to depth, counting codes still on their way', async () => {
		code();
		code({ synced: false });

		const result = await maintainCodePool([], NOW);

		expect(result.minted).toBe(DOOR_CODE_POOL_SIZE - 2);
		expect(mockAddLockUser).toHaveBeenCalledWith(
			expect.objectContaining({ type: 0, password: 42_424_242 })
		);
		const minted = sqlite
			.prepare('select count(*) as n from lock_fallback_code where pooled = 1')
			.get() as { n: number };
		expect(minted.n).toBe(DOOR_CODE_POOL_SIZE);
	});

	it('stops minting at the first refusal and records it', async () => {
		mockAddLockUser.mockRejectedValue(new Error('BAD-REQUEST'));
		const errors: string[] = [];

		const result = await maintainCodePool(errors, NOW);

		expect(mockAddLockUser).toHaveBeenCalledTimes(1);
		expect(result.minted).toBe(0);
		expect(errors[0]).toMatch(/could not mint/);
	});

	it('is a no-op on a full pool', async () => {
		fillPool();

		const result = await maintainCodePool([], NOW);

		expect(result).toEqual({
			confirmed: 0,
			released: 0,
			burned: 0,
			awaitingRemoval: 0,
			minted: 0,
			available: DOOR_CODE_POOL_SIZE
		});
		expect(await poolDepth()).toBe(DOOR_CODE_POOL_SIZE);
	});
});

describe('listPoolCodes', () => {
	it('names each code’s state for Key Holders', async () => {
		booking('over', hours(-4), hours(-2));
		booking('live', hours(-1), hours(1));
		const ready = code();
		const pending = code({ synced: false });
		const claimed = code({ claimedBy: 'live' });
		const awaiting = code({ claimedBy: 'over', revealed: true });
		const legacy = code({ pooled: false });

		const states = Object.fromEntries(
			(await listPoolCodes(NOW)).map((c) => [c.id, c.state] as const)
		);

		expect(states).toEqual({
			[ready]: 'available',
			[pending]: 'pending',
			[claimed]: 'claimed',
			[awaiting]: 'awaiting_removal',
			[legacy]: 'awaiting_removal'
		});
	});
});
