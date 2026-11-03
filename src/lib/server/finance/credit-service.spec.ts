import { describe, it, expect, beforeEach, vi } from 'vitest';

// The credit service has no db.transaction (D1 has none): it reads, writes with a
// compare-and-swap UPDATE … RETURNING, then inserts a ledger row. Against a real
// SQLite, so the CAS predicate and the SET keys are the real ones; contention is
// a write slipped in between the read and the CAS.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

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

const T0 = 1_750_000_000;

function member(id: string, freeHours = 0, equipment = 0) {
	sqlite
		.prepare(
			`insert into user (id, name, email, credit_free_hours, credit_equipment) values (?, ?, ?, ?, ?)`
		)
		.run(id, id, `${id}@example.com`, freeHours, equipment);
}

function ledgerRow(opts: {
	userId?: string;
	type?: string;
	amount: number;
	source: string;
	sourceId?: string | null;
	at: number;
}) {
	sqlite
		.prepare(
			`insert into credit_transaction (user_id, credit_type, amount, balance_after, source, source_id, description, created_at)
			 values (?, ?, ?, 0, ?, ?, 'seed', ?)`
		)
		.run(
			opts.userId ?? 'user-1',
			opts.type ?? 'free_hours',
			opts.amount,
			opts.source,
			opts.sourceId ?? null,
			opts.at
		);
}

const balances = (id: string) =>
	sqlite
		.prepare(
			'select credit_free_hours as free, credit_equipment as equipment from user where id = ?'
		)
		.get(id);
const ledger = () =>
	sqlite
		.prepare(
			`select user_id as userId, credit_type as creditType, amount, balance_after as balanceAfter,
			        source, source_id as sourceId, description from credit_transaction order by id`
		)
		.all() as Record<string, unknown>[];

/** Another writer moves the balance between this service's read and its CAS. */
function contend(times: number, bump = 2) {
	const update = testDb.update.bind(testDb);
	let left = times;
	return vi.spyOn(testDb, 'update').mockImplementation(((table: Parameters<typeof update>[0]) => {
		if (left-- > 0) {
			sqlite.prepare('update user set credit_free_hours = credit_free_hours + ?').run(bump);
		}
		return update(table);
	}) as typeof testDb.update);
}

beforeEach(() => {
	vi.restoreAllMocks();
	sqlite.exec('delete from credit_transaction');
	sqlite.exec('delete from user');
	member('user-1');
	member('user-2', 9, 9);
});

describe('getBalance / getAllBalances', () => {
	it('returns 0 for a member with no credits, and for one not found', async () => {
		expect(await getBalance('user-1', 'free_hours')).toBe(0);
		expect(await getBalance('missing', 'free_hours')).toBe(0);
		expect(await getAllBalances('missing')).toEqual({});
	});

	it('returns that member’s balances', async () => {
		sqlite.exec(`update user set credit_free_hours = 3, credit_equipment = 10 where id = 'user-1'`);

		expect(await getBalance('user-1', 'free_hours')).toBe(3);
		expect(await getAllBalances('user-1')).toEqual({ free_hours: 3, equipment_credits: 10 });
	});
});

describe('addCredits', () => {
	it('increases balance and creates a transaction', async () => {
		sqlite.exec(`update user set credit_free_hours = 2 where id = 'user-1'`);

		const result = await addCredits(
			'user-1',
			'free_hours',
			3,
			'admin_adjustment',
			undefined,
			'Test add'
		);

		expect(result).toBe(5);
		// The SET must land on the right column, and on this member only.
		expect(balances('user-1')).toEqual({ free: 5, equipment: 0 });
		expect(balances('user-2')).toEqual({ free: 9, equipment: 9 });
		expect(ledger()).toEqual([
			{
				userId: 'user-1',
				creditType: 'free_hours',
				amount: 3,
				balanceAfter: 5,
				source: 'admin_adjustment',
				sourceId: null,
				description: 'Test add'
			}
		]);
	});

	it('respects maxBalance cap from config', async () => {
		sqlite.exec(`update user set credit_equipment = 24990 where id = 'user-1'`);

		expect(await addCredits('user-1', 'equipment_credits', 20, 'monthly_allocation')).toBe(25000);
		expect(ledger()[0]).toMatchObject({ amount: 10, balanceAfter: 25000 });
	});

	it('retries the CAS when the balance changes concurrently', async () => {
		// Read sees 2, another writer makes it 4, the CAS misses; the retry reads 4
		// and lands 4 + 3 = 7.
		sqlite.exec(`update user set credit_free_hours = 2 where id = 'user-1'`);
		contend(1);

		expect(await addCredits('user-1', 'free_hours', 3, 'admin_adjustment')).toBe(7);
		// Exactly one ledger row — the failed attempt must not write a transaction.
		expect(ledger()).toHaveLength(1);
		expect(ledger()[0]).toMatchObject({ amount: 3, balanceAfter: 7 });
	});

	it('throws when contention persists past the retry limit', async () => {
		contend(Infinity);

		await expect(addCredits('user-1', 'free_hours', 1, 'admin_adjustment')).rejects.toThrow(
			'due to contention'
		);
		expect(ledger()).toHaveLength(0);
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
		await expect(addCredits('missing', 'free_hours', 1, 'admin_adjustment')).rejects.toThrow(
			'User missing not found'
		);
	});
});

describe('deductCredits', () => {
	it('decreases balance and creates a transaction', async () => {
		sqlite.exec(`update user set credit_free_hours = 5 where id = 'user-1'`);

		expect(await deductCredits('user-1', 'free_hours', 2, 'checkout', 'sess-123')).toBe(3);
		expect(balances('user-1')).toEqual({ free: 3, equipment: 0 });
		expect(balances('user-2')).toEqual({ free: 9, equipment: 9 });
		expect(ledger()[0]).toMatchObject({
			userId: 'user-1',
			creditType: 'free_hours',
			amount: -2,
			balanceAfter: 3,
			source: 'checkout',
			sourceId: 'sess-123'
		});
	});

	it('deducts the exact balance down to zero', async () => {
		sqlite.exec(`update user set credit_free_hours = 2 where id = 'user-1'`);
		expect(await deductCredits('user-1', 'free_hours', 2, 'checkout')).toBe(0);
	});

	it('throws InsufficientCreditsError when balance is too low, writing nothing', async () => {
		sqlite.exec(`update user set credit_free_hours = 1 where id = 'user-1'`);

		await expect(deductCredits('user-1', 'free_hours', 5, 'checkout')).rejects.toBeInstanceOf(
			InsufficientCreditsError
		);
		expect(balances('user-1')).toEqual({ free: 1, equipment: 0 });
		expect(ledger()).toHaveLength(0);
	});

	it('throws when amount is not positive', async () => {
		await expect(deductCredits('user-1', 'free_hours', 0, 'admin_adjustment')).rejects.toThrow(
			'Amount must be positive'
		);
	});
});

describe('setBalance', () => {
	it('resets to exact value and records the delta', async () => {
		sqlite.exec(`update user set credit_free_hours = 8 where id = 'user-1'`);

		expect(await setBalance('user-1', 'free_hours', 5, 'monthly_allocation', 'sub-123')).toBe(5);
		expect(ledger()[0]).toMatchObject({
			amount: -3,
			balanceAfter: 5,
			source: 'monthly_allocation',
			sourceId: 'sub-123'
		});
	});

	it('retries the CAS, computing the delta against the re-read balance', async () => {
		sqlite.exec(`update user set credit_free_hours = 8 where id = 'user-1'`);
		contend(1, -2);

		expect(await setBalance('user-1', 'free_hours', 5, 'monthly_allocation')).toBe(5);
		expect(ledger()).toHaveLength(1);
		expect(ledger()[0]).toMatchObject({ amount: -1, balanceAfter: 5 });
	});

	it('throws for negative balance', async () => {
		await expect(setBalance('user-1', 'free_hours', -1, 'admin_adjustment')).rejects.toThrow(
			'Balance cannot be negative'
		);
	});

	it('throws when user not found', async () => {
		await expect(setBalance('missing', 'free_hours', 5, 'admin_adjustment')).rejects.toThrow(
			'User missing not found'
		);
	});
});

describe('hasTransaction', () => {
	it('matches on source, source id, and credit type when given', async () => {
		ledgerRow({ amount: 5, source: 'monthly_allocation', sourceId: 'inv_123', at: T0 });

		expect(await hasTransaction('monthly_allocation', 'inv_123')).toBe(true);
		expect(await hasTransaction('monthly_allocation', 'inv_999')).toBe(false);
		expect(await hasTransaction('admin_adjustment', 'inv_123')).toBe(false);
		expect(await hasTransaction('monthly_allocation', 'inv_123', 'equipment_credits')).toBe(false);
	});
});

describe('allocateMonthlyCredits', () => {
	it('sets the free_hours balance', async () => {
		sqlite.exec(`update user set credit_free_hours = 3 where id = 'user-1'`);

		expect(await allocateMonthlyCredits('user-1', 5, 'inv_abc')).toBe(5);
		expect(ledger()[0]).toMatchObject({
			creditType: 'free_hours',
			source: 'monthly_allocation',
			sourceId: 'inv_abc'
		});
	});

	it('skips allocation when the invoice was already processed', async () => {
		await allocateMonthlyCredits('user-1', 5, 'inv_dup');
		sqlite.exec(`update user set credit_free_hours = 2 where id = 'user-1'`);

		expect(await allocateMonthlyCredits('user-1', 5, 'inv_dup')).toBe(2);
		expect(ledger()).toHaveLength(1);
	});
});

describe('allocateEquipmentCredits', () => {
	it('adds equipment credits', async () => {
		sqlite.exec(`update user set credit_equipment = 100 where id = 'user-1'`);

		expect(await allocateEquipmentCredits('user-1', 50, 'sub-xyz')).toBe(150);
		expect(ledger()[0]).toMatchObject({
			creditType: 'equipment_credits',
			source: 'monthly_allocation',
			sourceId: 'sub-xyz'
		});
	});

	it('skips a redelivered invoice instead of double-granting', async () => {
		await allocateEquipmentCredits('user-1', 50, 'inv_dup');

		expect(await allocateEquipmentCredits('user-1', 50, 'inv_dup')).toBe(50);
		expect(ledger()).toHaveLength(1);
	});

	it('is not fooled by a free-hours row for the same invoice', async () => {
		// The guard is per credit type: one invoice allocates both.
		await allocateMonthlyCredits('user-1', 4, 'inv_both');

		expect(await allocateEquipmentCredits('user-1', 50, 'inv_both')).toBe(50);
	});
});

describe('getUsageSinceLastAllocation', () => {
	it('returns null when the user has never had an allocation', async () => {
		ledgerRow({ amount: -2, source: 'checkout', at: T0 });
		expect(await getUsageSinceLastAllocation('user-1', 'free_hours')).toBeNull();
	});

	it('sums net deductions after the latest allocation only', async () => {
		ledgerRow({ amount: 10, source: 'monthly_allocation', at: T0 });
		ledgerRow({ amount: -7, source: 'checkout', at: T0 + 10 });
		ledgerRow({ amount: 10, source: 'monthly_allocation', at: T0 + 100 });
		ledgerRow({ amount: -3, source: 'checkout', at: T0 + 110 });
		ledgerRow({ amount: -1, source: 'checkout', at: T0 + 120 });
		// Neither another member's spend nor another credit type counts.
		ledgerRow({ userId: 'user-2', amount: -5, source: 'checkout', at: T0 + 130 });
		ledgerRow({ type: 'equipment_credits', amount: -5, source: 'checkout', at: T0 + 130 });

		expect(await getUsageSinceLastAllocation('user-1', 'free_hours')).toBe(4);
	});

	it('clamps to zero when reversals outweigh deductions', async () => {
		ledgerRow({ amount: 10, source: 'monthly_allocation', at: T0 });
		ledgerRow({ amount: -1, source: 'checkout', at: T0 + 10 });
		ledgerRow({ amount: 3, source: 'admin_adjustment', at: T0 + 20 });

		expect(await getUsageSinceLastAllocation('user-1', 'free_hours')).toBe(0);
	});
});
