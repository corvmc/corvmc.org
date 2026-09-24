import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the db module. The credit service no longer uses db.transaction (D1 has
// no interactive transactions); it reads, then writes with a compare-and-swap
// UPDATE ... RETURNING, then inserts a ledger row. The mock exposes queues so a
// test can script the exact sequence of select/update results — including a CAS
// miss (empty returning) to exercise the retry path.
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let updateResults: unknown[][] = [];
const insertedRows: Record<string, unknown>[] = [];
const setPayloads: Record<string, unknown>[] = [];

/** A thenable chain whose await pops the next result from `queue`. */
function chain(queue: () => unknown[][]): PromiseLike<unknown[]> {
	const proxy: PromiseLike<unknown[]> = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue().shift() ?? []);
			}
			if (prop === 'returning') {
				return () => chain(() => updateResults);
			}
			if (prop === 'set') {
				return (payload: Record<string, unknown>) => {
					setPayloads.push(payload);
					return proxy;
				};
			}
			return () => proxy;
		}
	}) as unknown as PromiseLike<unknown[]>;
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(() => selectResults),
		update: () => chain(() => updateResults),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				insertedRows.push(row);
				return Promise.resolve();
			}
		})
	}
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: {
		id: 'id',
		creditFreeHours: { name: 'credit_free_hours' },
		creditEquipment: { name: 'credit_equipment' }
	}
}));

vi.mock('$lib/server/db/schema/finance', () => ({
	creditTransaction: { id: 'id' },
	isCreditType: (v: string) => ['free_hours', 'equipment_credits'].includes(v),
	creditTypes: ['free_hours', 'equipment_credits'] as const
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	getTableColumns: () => ({}),
	and: vi.fn(),
	gt: vi.fn(),
	gte: vi.fn(),
	lte: vi.fn(),
	desc: vi.fn(),
	like: vi.fn(),
	or: vi.fn(),
	count: vi.fn(),
	// `.mapWith` because `event-columns` decodes one fragment at import.
	sql: vi.fn(() => ({ mapWith: vi.fn() }))
}));

// Import after mocking
const {
	getBalance,
	getAllBalances,
	addCredits,
	deductCredits,
	setBalance,
	allocateMonthlyCredits,
	allocateEquipmentCredits,
	getUsageSinceLastAllocation,
	hasTransaction,
	InsufficientCreditsError
} = await import('./credit-service');

// The real `user` schema exposes Drizzle column *properties* keyed by their TS
// names (creditFreeHours), distinct from the DB column names (credit_free_hours)
// returned by `column.name`. `.set()` must be keyed by the property name; passing
// the DB name yields an empty SET clause and a SQLite syntax error in production.
const VALID_USER_COLUMNS = ['id', 'creditFreeHours', 'creditEquipment'];

beforeEach(() => {
	selectResults = [];
	updateResults = [];
	insertedRows.length = 0;
	setPayloads.length = 0;
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('getBalance', () => {
	it('returns 0 for user with no credits', async () => {
		selectResults = [[{ free_hours: 0, equipment_credits: 0 }]];
		expect(await getBalance('user-1', 'free_hours')).toBe(0);
	});

	it('returns 0 when user not found', async () => {
		selectResults = [[]];
		expect(await getBalance('missing', 'free_hours')).toBe(0);
	});

	it('returns the balance for a credit type that exists', async () => {
		selectResults = [[{ free_hours: 5, equipment_credits: 0 }]];
		expect(await getBalance('user-1', 'free_hours')).toBe(5);
	});
});

describe('getAllBalances', () => {
	it('returns empty object for user not found', async () => {
		selectResults = [[]];
		expect(await getAllBalances('missing')).toEqual({});
	});

	it('returns parsed credits', async () => {
		selectResults = [[{ free_hours: 3, equipment_credits: 10 }]];
		expect(await getAllBalances('user-1')).toEqual({ free_hours: 3, equipment_credits: 10 });
	});
});

// ---------------------------------------------------------------------------
// addCredits
// ---------------------------------------------------------------------------

describe('addCredits', () => {
	it('increases balance and creates a transaction', async () => {
		selectResults = [[{ balance: 2 }]];
		updateResults = [[{ balance: 5 }]]; // CAS succeeds

		const result = await addCredits(
			'user-1',
			'free_hours',
			3,
			'admin_adjustment',
			undefined,
			'Test add'
		);
		expect(result).toBe(5);
		// Regression: CAS UPDATE must SET the schema property, not the DB column name.
		expect(Object.keys(setPayloads[0])).toEqual(['creditFreeHours']);
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			userId: 'user-1',
			creditType: 'free_hours',
			amount: 3,
			balanceAfter: 5,
			source: 'admin_adjustment',
			description: 'Test add'
		});
	});

	it('initializes balance when credit type does not exist yet', async () => {
		selectResults = [[{ balance: 0 }]];
		updateResults = [[{ balance: 4 }]];

		const result = await addCredits('user-1', 'free_hours', 4, 'monthly_allocation');
		expect(result).toBe(4);
		expect(insertedRows[0]).toMatchObject({ amount: 4, balanceAfter: 4 });
	});

	it('respects maxBalance cap from config', async () => {
		selectResults = [[{ balance: 24990 }]];
		updateResults = [[{ balance: 25000 }]];

		const result = await addCredits('user-1', 'equipment_credits', 20, 'monthly_allocation');
		expect(result).toBe(25000);
		expect(insertedRows[0]).toMatchObject({ amount: 10, balanceAfter: 25000 });
	});

	it('retries the CAS when the balance changes concurrently', async () => {
		// First read sees 2 but the CAS misses (someone else wrote between read and
		// write). Second read sees 4; CAS succeeds at 4 + 3 = 7.
		selectResults = [[{ balance: 2 }], [{ balance: 4 }]];
		updateResults = [[], [{ balance: 7 }]];

		const result = await addCredits('user-1', 'free_hours', 3, 'admin_adjustment');
		expect(result).toBe(7);
		// Exactly one ledger row — the failed attempt must not write a transaction.
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({ amount: 3, balanceAfter: 7 });
	});

	it('throws when contention persists past the retry limit', async () => {
		// Supply a fresh read for every attempt but never let the CAS land.
		selectResults = Array.from({ length: 10 }, () => [{ balance: 2 }]);
		updateResults = Array.from({ length: 10 }, () => []);

		await expect(addCredits('user-1', 'free_hours', 1, 'admin_adjustment')).rejects.toThrow(
			'due to contention'
		);
		expect(insertedRows).toHaveLength(0);
	});

	it('throws when amount is not positive', async () => {
		await expect(addCredits('user-1', 'free_hours', 0, 'admin_adjustment')).rejects.toThrow(
			'Amount must be positive'
		);
		await expect(addCredits('user-1', 'free_hours', -1, 'admin_adjustment')).rejects.toThrow(
			'Amount must be positive'
		);
	});

	it('throws when user not found', async () => {
		selectResults = [[]];
		await expect(addCredits('missing', 'free_hours', 1, 'admin_adjustment')).rejects.toThrow(
			'User missing not found'
		);
	});
});

// ---------------------------------------------------------------------------
// deductCredits
// ---------------------------------------------------------------------------

describe('deductCredits', () => {
	it('decreases balance and creates a transaction', async () => {
		updateResults = [[{ newBalance: 3 }]]; // conditional UPDATE matched

		const result = await deductCredits('user-1', 'free_hours', 2, 'checkout', 'sess-123');
		expect(result).toBe(3);
		// Regression: the UPDATE must SET the schema property (creditFreeHours), not
		// the DB column name. A wrong key makes Drizzle emit `set` with no assignments.
		expect(setPayloads).toHaveLength(1);
		expect(Object.keys(setPayloads[0])).toEqual(['creditFreeHours']);
		expect(Object.keys(setPayloads[0]).every((k) => VALID_USER_COLUMNS.includes(k))).toBe(true);
		expect(insertedRows[0]).toMatchObject({
			userId: 'user-1',
			creditType: 'free_hours',
			amount: -2,
			balanceAfter: 3,
			source: 'checkout',
			sourceId: 'sess-123'
		});
	});

	it('throws InsufficientCreditsError when balance is too low', async () => {
		updateResults = [[]]; // UPDATE ... WHERE balance >= amount matched no rows
		selectResults = [[{ free_hours: 1, equipment_credits: 0 }]]; // re-read for error detail

		await expect(deductCredits('user-1', 'free_hours', 5, 'checkout')).rejects.toBeInstanceOf(
			InsufficientCreditsError
		);
		// No ledger row when the deduction is rejected.
		expect(insertedRows).toHaveLength(0);
	});

	it('throws when amount is not positive', async () => {
		await expect(deductCredits('user-1', 'free_hours', 0, 'admin_adjustment')).rejects.toThrow(
			'Amount must be positive'
		);
	});
});

// ---------------------------------------------------------------------------
// setBalance
// ---------------------------------------------------------------------------

describe('setBalance', () => {
	it('resets to exact value and records the delta', async () => {
		selectResults = [[{ balance: 8 }]];
		updateResults = [[{ balance: 5 }]];

		const result = await setBalance('user-1', 'free_hours', 5, 'monthly_allocation', 'sub-123');
		expect(result).toBe(5);
		expect(insertedRows[0]).toMatchObject({
			amount: -3,
			balanceAfter: 5,
			source: 'monthly_allocation',
			sourceId: 'sub-123'
		});
	});

	it('sets balance from zero', async () => {
		selectResults = [[{ balance: 0 }]];
		updateResults = [[{ balance: 10 }]];

		const result = await setBalance('user-1', 'free_hours', 10, 'monthly_allocation');
		expect(result).toBe(10);
		expect(insertedRows[0]).toMatchObject({ amount: 10, balanceAfter: 10 });
	});

	it('retries the CAS when the balance changes concurrently', async () => {
		selectResults = [[{ balance: 8 }], [{ balance: 6 }]];
		updateResults = [[], [{ balance: 5 }]];

		const result = await setBalance('user-1', 'free_hours', 5, 'monthly_allocation');
		expect(result).toBe(5);
		expect(insertedRows).toHaveLength(1);
		// Delta is computed against the re-read balance (6), not the stale one.
		expect(insertedRows[0]).toMatchObject({ amount: -1, balanceAfter: 5 });
	});

	it('throws for negative balance', async () => {
		await expect(setBalance('user-1', 'free_hours', -1, 'admin_adjustment')).rejects.toThrow(
			'Balance cannot be negative'
		);
	});

	it('throws when user not found', async () => {
		selectResults = [[]];
		await expect(setBalance('missing', 'free_hours', 5, 'admin_adjustment')).rejects.toThrow(
			'User missing not found'
		);
	});
});

// ---------------------------------------------------------------------------
// hasTransaction
// ---------------------------------------------------------------------------

describe('hasTransaction', () => {
	it('returns true when a matching transaction exists', async () => {
		selectResults = [[{ id: 1 }]];
		expect(await hasTransaction('monthly_allocation', 'inv_123')).toBe(true);
	});

	it('returns false when no matching transaction exists', async () => {
		selectResults = [[]];
		expect(await hasTransaction('monthly_allocation', 'inv_999')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// allocateMonthlyCredits / allocateEquipmentCredits
// ---------------------------------------------------------------------------

describe('allocateMonthlyCredits', () => {
	it('sets free_hours balance via setBalance', async () => {
		// Reads in order: hasTransaction (none), then setBalance's balance read.
		selectResults = [[], [{ balance: 3 }]];
		updateResults = [[{ balance: 5 }]];

		const result = await allocateMonthlyCredits('user-1', 5, 'inv_abc');
		expect(result).toBe(5);
		expect(insertedRows[0]).toMatchObject({
			creditType: 'free_hours',
			source: 'monthly_allocation',
			sourceId: 'inv_abc'
		});
	});

	it('skips allocation when invoice was already processed', async () => {
		// hasTransaction finds an existing row; getBalance then re-reads balances.
		selectResults = [[{ id: 99 }], [{ free_hours: 5, equipment_credits: 0 }]];

		const result = await allocateMonthlyCredits('user-1', 5, 'inv_dup');
		expect(result).toBe(5);
		expect(insertedRows).toHaveLength(0);
	});
});

describe('allocateEquipmentCredits', () => {
	it('adds equipment credits via addCredits', async () => {
		// hasTransaction (none), then addCredits' balance read.
		selectResults = [[], [{ balance: 100 }]];
		updateResults = [[{ balance: 150 }]];

		const result = await allocateEquipmentCredits('user-1', 50, 'sub-xyz');
		expect(result).toBe(150);
		expect(insertedRows[0]).toMatchObject({
			creditType: 'equipment_credits',
			source: 'monthly_allocation',
			sourceId: 'sub-xyz'
		});
	});

	it('skips allocation when invoice was already processed', async () => {
		// hasTransaction finds an existing equipment_credits row; getBalance re-reads.
		selectResults = [[{ id: 99 }], [{ free_hours: 0, equipment_credits: 100 }]];

		const result = await allocateEquipmentCredits('user-1', 50, 'inv_dup');
		expect(result).toBe(100);
		expect(insertedRows).toHaveLength(0);
	});
});

describe('getUsageSinceLastAllocation', () => {
	beforeEach(() => {
		selectResults = [];
		updateResults = [];
		insertedRows.length = 0;
		setPayloads.length = 0;
	});

	it('returns null when the user has never had an allocation', async () => {
		selectResults = [[]]; // no monthly_allocation row

		const result = await getUsageSinceLastAllocation('user-1', 'free_hours');
		expect(result).toBeNull();
	});

	it('sums net deductions after the latest allocation', async () => {
		selectResults = [
			[{ createdAt: new Date('2026-07-01T00:00:00Z') }], // latest allocation
			[{ used: 4 }] // -sum(amount) after it
		];

		const result = await getUsageSinceLastAllocation('user-1', 'free_hours');
		expect(result).toBe(4);
	});

	it('clamps to zero when reversals outweigh deductions', async () => {
		selectResults = [[{ createdAt: new Date('2026-07-01T00:00:00Z') }], [{ used: -2 }]];

		const result = await getUsageSinceLastAllocation('user-1', 'free_hours');
		expect(result).toBe(0);
	});
});
