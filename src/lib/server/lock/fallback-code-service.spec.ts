import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;
const updateCalls: Array<Record<string, unknown>> = [];
const insertCalls: Array<Record<string, unknown>> = [];
const deleteCalls: number[] = [];

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

function buildWriteChain(record: (data: unknown) => void, key: 'set' | 'values') {
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
		insert: () => buildWriteChain((d) => insertCalls.push(d as Record<string, unknown>), 'values'),
		delete: () => {
			deleteCalls.push(deleteCalls.length);
			return buildWriteChain(() => {}, 'set');
		}
	}
}));

vi.mock('$lib/server/db/schema/reservation', () => ({
	reservation: { id: 'id', lockFallbackRevealedAt: 'lock_fallback_revealed_at' },
	lockFallbackCode: {
		id: 'id',
		code: 'code',
		lockAccessId: 'lock_access_id',
		syncedAt: 'synced_at',
		retiredAt: 'retired_at',
		createdAt: 'created_at'
	}
}));

vi.mock('drizzle-orm', () => ({
	and: vi.fn(),
	eq: vi.fn(),
	desc: vi.fn(),
	isNull: vi.fn(),
	isNotNull: vi.fn()
}));

const mockAddLockUser = vi.fn().mockResolvedValue(9001);
const mockGetLockUser = vi.fn().mockResolvedValue(null);
const mockRemoveTemporaryUser = vi.fn().mockResolvedValue(undefined);

vi.mock('./ultraloc-client', () => ({
	addLockUser: (...args: unknown[]) => mockAddLockUser(...args),
	getLockUser: (...args: unknown[]) => mockGetLockUser(...args),
	removeTemporaryUser: (...args: unknown[]) => mockRemoveTemporaryUser(...args),
	generateLockCode: () => 4242,
	LOCK_GRACE_MINUTES: 30
}));

const { maintainFallbackCode, revealFallbackCodeFor, FALLBACK_ROTATION_DAYS } =
	await import('./fallback-code-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);

/** maintainFallbackCode selects: pending, active, [pending again], active. */
function noPending() {
	return [];
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	selectCallIndex = 0;
	updateCalls.length = 0;
	insertCalls.length = 0;
	deleteCalls.length = 0;
	mockAddLockUser.mockResolvedValue(9001);
	mockGetLockUser.mockResolvedValue(null);
	mockRemoveTemporaryUser.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// maintainFallbackCode
// ---------------------------------------------------------------------------

describe('maintainFallbackCode', () => {
	it('mints a break-glass code when there is none at all', async () => {
		selectResults.push(noPending()); // pending
		selectResults.push([]); // active
		selectResults.push(noPending()); // still pending?
		selectResults.push([]); // active, after minting

		const errors: string[] = [];
		const result = await maintainFallbackCode(errors);

		expect(mockAddLockUser).toHaveBeenCalledWith(
			expect.objectContaining({ type: 0, name: expect.stringContaining('CMC Fallback') })
		);
		expect(insertCalls[0]).toMatchObject({ lockAccessId: '9001' });
		// Not usable until the lock confirms it.
		expect(result.active).toBeNull();
		expect(errors).toHaveLength(0);
	});

	it('leaves a current confirmed code alone', async () => {
		const active = [{ id: 'f1', code: '87654321', lockAccessId: '1', syncedAt: daysAgo(2) }];
		selectResults.push(noPending());
		selectResults.push(active);
		selectResults.push(active); // final read

		const result = await maintainFallbackCode([]);

		expect(mockAddLockUser).not.toHaveBeenCalled();
		expect(result.active).toBe('87654321');
		expect(result.rotated).toBe(false);
	});

	it('mints a successor once the incumbent is past the rotation period', async () => {
		const active = [
			{
				id: 'f1',
				code: '11112222',
				lockAccessId: '1',
				syncedAt: daysAgo(FALLBACK_ROTATION_DAYS + 1)
			}
		];
		selectResults.push(noPending());
		selectResults.push(active);
		selectResults.push(noPending());
		selectResults.push(active); // the old one is still what members get

		await maintainFallbackCode([]);

		expect(mockAddLockUser).toHaveBeenCalled();
		// The incumbent is untouched — it stays live until the successor confirms.
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(updateCalls).toHaveLength(0);
	});

	// The whole point of the design: never a gap with no working code.
	it('promotes a synced successor before retiring the code it replaces', async () => {
		const pending = [{ id: 'f2', code: '33334444', lockAccessId: '222', syncedAt: null }];
		const outgoing = [{ id: 'f1', code: '11112222', lockAccessId: '111', syncedAt: daysAgo(40) }];
		selectResults.push(pending); // pending
		selectResults.push(outgoing); // active, inside promote
		selectResults.push(pending.map((p) => ({ ...p, syncedAt: new Date() }))); // active after promote
		selectResults.push([]); // rotation check finds nothing pending
		selectResults.push(pending.map((p) => ({ ...p, syncedAt: new Date() }))); // final read
		mockGetLockUser.mockResolvedValue({ id: 222, type: 0, syncStatus: 1 });

		const result = await maintainFallbackCode([]);

		expect(result.rotated).toBe(true);
		// Successor marked synced first, incumbent retired second.
		expect(updateCalls[0]).toMatchObject({ syncedAt: expect.any(Date) });
		expect(updateCalls[1]).toMatchObject({ retiredAt: expect.any(Date) });
		expect(mockRemoveTemporaryUser).toHaveBeenCalledWith(111);
	});

	it('does not promote a successor the lock has not confirmed', async () => {
		selectResults.push([{ id: 'f2', code: '3333', lockAccessId: '222', syncedAt: null }]);
		selectResults.push([{ id: 'f1', code: '1111', lockAccessId: '111', syncedAt: daysAgo(2) }]);
		selectResults.push([{ id: 'f1', code: '1111', lockAccessId: '111', syncedAt: daysAgo(2) }]);
		mockGetLockUser.mockResolvedValue({ id: 222, type: 0, syncStatus: 0 });

		const result = await maintainFallbackCode([]);

		expect(result.rotated).toBe(false);
		expect(mockRemoveTemporaryUser).not.toHaveBeenCalled();
		expect(updateCalls).toHaveLength(0);
	});

	// Otherwise every daily run during an outage adds another dead lock user.
	it('does not mint a second successor while one is already in flight', async () => {
		const pending = [{ id: 'f2', code: '3333', lockAccessId: '222', syncedAt: null }];
		selectResults.push(pending);
		selectResults.push([]); // no active code at all
		selectResults.push(pending); // still pending
		selectResults.push([]);
		mockGetLockUser.mockResolvedValue({ id: 222, type: 0, syncStatus: 0 });

		await maintainFallbackCode([]);

		expect(mockAddLockUser).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// revealFallbackCodeFor
// ---------------------------------------------------------------------------

describe('revealFallbackCodeFor', () => {
	const inWindow = {
		id: 'res-1',
		status: 'confirmed',
		startsAt: new Date(Date.now() - 10 * 60_000),
		endsAt: new Date(Date.now() + 60 * 60_000),
		lockSyncedAt: null
	};

	it('hands over the code and records who was given it', async () => {
		selectResults.push([{ id: 'f1', code: '87654321', syncedAt: daysAgo(1) }]);

		expect(await revealFallbackCodeFor(inWindow)).toBe('87654321');
		expect(updateCalls[0]).toMatchObject({ lockFallbackRevealedAt: expect.any(Date) });
	});

	it('does not reveal it to a member whose own code is known good', async () => {
		expect(await revealFallbackCodeFor({ ...inWindow, lockSyncedAt: new Date() })).toBeNull();
		expect(updateCalls).toHaveLength(0);
	});

	it('does not reveal it outside the access window', async () => {
		const nextWeek = {
			...inWindow,
			startsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
			endsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000 + 3_600_000)
		};
		expect(await revealFallbackCodeFor(nextWeek)).toBeNull();
	});

	it('does not reveal it for an unconfirmed reservation', async () => {
		expect(await revealFallbackCodeFor({ ...inWindow, status: 'scheduled' })).toBeNull();
	});

	it('returns null rather than inventing one when no code is active', async () => {
		selectResults.push([]);
		expect(await revealFallbackCodeFor(inWindow)).toBeNull();
		expect(updateCalls).toHaveLength(0);
	});
});
