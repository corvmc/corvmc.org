import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The financial record's aggregates, against a real SQLite.
 *
 * `SUM` and `GROUP BY` over a signed column: a mocked `db` returns whatever the
 * test told it to and agrees with any `WHERE`. DDL comes from the migration.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	// `await import`, not `require`: the helper is TypeScript, which Node's
	// require cannot load. An async hoisted factory still resolves before the
	// mock below is asked for a database.
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const {
	listForSubject,
	poolBalanceCents,
	recordEntries,
	recordEntry,
	reverseEntriesForPaymentRecord,
	ledgerStartsAt,
	stripeSettledCents,
	totalEarnedCents,
	totalsByCategory,
	totalsByKindAndCategory
} = await import('./financial-entry-service');
type RecordEntryInput = Parameters<typeof recordEntry>[0];

const JAN = new Date('2026-01-15T00:00:00Z');
const FEB = new Date('2026-02-15T00:00:00Z');
const DEC = new Date('2026-12-15T00:00:00Z');
const YEAR = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') };
const JANUARY = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T23:59:59Z') };

/** A $10 ticket at the default split, as the spec's worked example writes it. */
const ticketSale = (over: Partial<RecordEntryInput> = {}): RecordEntryInput => ({
	amountCents: 300,
	kind: 'earned' as const,
	category: 'ticket_sales' as const,
	occurredAt: JAN,
	settlement: 'stripe' as const,
	subjectType: 'ticket' as const,
	subjectId: 'tkt-1',
	description: 'Ticket',
	...over
});

beforeEach(() => sqlite.exec('delete from financial_entry'));

describe('refunds reverse rather than mutate', () => {
	/** The three rows a $10 card sale writes, all carrying the payment record. */
	const sold = async (occurredAt = JAN) => {
		await recordEntries([
			ticketSale({ occurredAt, stripePaymentRecordId: 'pr_1' }),
			ticketSale({
				occurredAt,
				amountCents: 700,
				kind: 'pass_through',
				category: 'act_payout',
				settlementGroup: 'evt-1',
				stripePaymentRecordId: 'pr_1'
			}),
			ticketSale({
				occurredAt,
				amountCents: -59,
				kind: 'spent',
				category: 'card_fees',
				stripePaymentRecordId: 'pr_1'
			})
		]);
	};

	it('negates every row the sale wrote', async () => {
		await sold();

		expect(await reverseEntriesForPaymentRecord('pr_1', FEB)).toBe(3);

		const rows = await listForSubject('ticket', 'tkt-1');
		expect(rows).toHaveLength(6);
		expect(rows.reduce((n, r) => n + r.amountCents, 0)).toBe(0);
	});

	/**
	 * The rule the whole append-only shape exists for: a February refund against
	 * a January sale must leave January reading what it read when it was
	 * reported.
	 */
	it('leaves the month of the sale alone', async () => {
		await sold(JAN);
		await reverseEntriesForPaymentRecord('pr_1', FEB);

		expect(await totalEarnedCents(JANUARY)).toBe(300);
		expect(await totalEarnedCents(YEAR)).toBe(0);
	});

	// A reversal carries the same payment record, so a second pass would negate
	// its own work and write three rows of nonsense.
	it('does not reverse a reversal', async () => {
		await sold();
		await reverseEntriesForPaymentRecord('pr_1', FEB);

		expect(await reverseEntriesForPaymentRecord('pr_1', FEB)).toBe(0);
		expect(await listForSubject('ticket', 'tkt-1')).toHaveLength(6);
	});

	it('reverses nothing for a payment record that wrote nothing', async () => {
		expect(await reverseEntriesForPaymentRecord('pr_unknown')).toBe(0);
	});

	// The acts' pool has to keep netting to zero after a refund, or a settlement
	// reads a balance that was handed back.
	it('keeps the pass-through pool at zero', async () => {
		await sold();
		await reverseEntriesForPaymentRecord('pr_1', FEB);

		expect(await poolBalanceCents('evt-1')).toBe(0);
	});
});

describe('recording', () => {
	it('writes a sale as the several rows it actually is', async () => {
		await recordEntries([
			ticketSale(),
			ticketSale({
				amountCents: 700,
				kind: 'pass_through',
				category: 'act_payout',
				settlementGroup: 'evt-1'
			}),
			ticketSale({ amountCents: -59, kind: 'spent', category: 'card_fees' })
		]);

		const rows = await listForSubject('ticket', 'tkt-1');
		expect(rows).toHaveLength(3);
		// $9.41 reaches the Stripe balance; the collective keeps $2.41 of it.
		expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(941);
	});

	it('writes nothing for an empty batch rather than erroring', async () => {
		await expect(recordEntries([])).resolves.toBeUndefined();
	});

	it('writes a single entry through the singular helper', async () => {
		await recordEntry(ticketSale({ description: 'One row' }));
		expect(await listForSubject('ticket', 'tkt-1')).toHaveLength(1);
	});
});

describe('what the collective kept', () => {
	it('sums only earned, never in-kind or pass-through', async () => {
		await recordEntries([
			ticketSale({ amountCents: 300 }),
			ticketSale({ amountCents: 700, kind: 'pass_through', category: 'act_payout' }),
			ticketSale({ amountCents: 25_000, kind: 'in_kind', category: 'equipment' }),
			ticketSale({ amountCents: -59, kind: 'spent', category: 'card_fees' })
		]);

		// The donated amp and the acts' cut are the two a naive sum gets wrong.
		expect(await totalEarnedCents(YEAR)).toBe(300);
	});

	it('respects the window', async () => {
		await recordEntries([ticketSale(), ticketSale({ occurredAt: DEC, subjectId: 'tkt-2' })]);
		expect(await totalEarnedCents(JANUARY)).toBe(300);
		expect(await totalEarnedCents(YEAR)).toBe(600);
	});

	it('is zero rather than null when nothing matches', async () => {
		expect(await totalEarnedCents(YEAR)).toBe(0);
	});
});

describe('totals by category', () => {
	it('groups one kind and leaves the others out', async () => {
		await recordEntries([
			ticketSale({ amountCents: -59, kind: 'spent', category: 'card_fees' }),
			ticketSale({ amountCents: -41, kind: 'spent', category: 'card_fees', subjectId: 'tkt-2' }),
			ticketSale({ amountCents: -12_000, kind: 'spent', category: 'contractor' }),
			ticketSale({ amountCents: 300 })
		]);

		const rows = await totalsByCategory('spent', YEAR);
		expect(rows).toEqual(
			expect.arrayContaining([
				{ category: 'card_fees', totalCents: -100 },
				{ category: 'contractor', totalCents: -12_000 }
			])
		);
		expect(rows).toHaveLength(2);
	});
});

describe('a pass-through pool', () => {
	const pool = (amount: number, over = {}) =>
		ticketSale({
			amountCents: amount,
			kind: 'pass_through' as const,
			category: 'act_payout' as const,
			settlementGroup: 'evt-1',
			...over
		});

	it('nets to zero once the act is paid', async () => {
		await recordEntries([pool(700), pool(700, { subjectId: 'tkt-2' }), pool(-1400)]);
		expect(await poolBalanceCents('evt-1')).toBe(0);
	});

	it('is positive while money is held and still owed', async () => {
		await recordEntries([pool(700), pool(700, { subjectId: 'tkt-2' })]);
		expect(await poolBalanceCents('evt-1')).toBe(1400);
	});

	it('goes negative when a refund lands after settlement, and stays there', async () => {
		// $14 in, $14 paid to the act, then the sale reversed. The collective is
		// $14 down and the pool balance is that number, correctly signed.
		await recordEntries([pool(1400), pool(-1400), pool(-1400, { occurredAt: FEB })]);
		expect(await poolBalanceCents('evt-1')).toBe(-1400);
	});

	it('does not let one event\u2019s pool answer for another', async () => {
		// The whole reason a global sum proves nothing: two errors cancel.
		await recordEntries([pool(1400), pool(-1400, { settlementGroup: 'evt-2' })]);
		expect(await poolBalanceCents('evt-1')).toBe(1400);
		expect(await poolBalanceCents('evt-2')).toBe(-1400);
	});
});

describe('the Stripe cross-check', () => {
	it('sums what settled through Stripe and ignores cash and credits', async () => {
		await recordEntries([
			ticketSale({ amountCents: 300 }),
			ticketSale({ amountCents: 500, settlement: 'cash', subjectId: 'tkt-2' }),
			ticketSale({ amountCents: 0, settlement: 'credit', subjectId: 'tkt-3' })
		]);
		expect(await stripeSettledCents(YEAR)).toBe(300);
	});
});

describe('the annual rollup\u2019s one query', () => {
	it('separates kinds that share a category', async () => {
		// The case a `GROUP BY category` alone gets wrong: the same $7 is a
		// pass-through liability and would otherwise net against ticket income.
		await recordEntries([
			ticketSale({ amountCents: 300 }),
			ticketSale({ amountCents: 700, kind: 'pass_through', subjectId: 'tkt-2' }),
			ticketSale({ amountCents: 2500, category: 'membership', subjectId: 'sub-1' })
		]);

		const rows = await totalsByKindAndCategory(YEAR);

		expect(rows).toContainEqual({ kind: 'earned', category: 'ticket_sales', totalCents: 300 });
		expect(rows).toContainEqual({
			kind: 'pass_through',
			category: 'ticket_sales',
			totalCents: 700
		});
		expect(rows).toContainEqual({ kind: 'earned', category: 'membership', totalCents: 2500 });
	});

	it('honours the range', async () => {
		await recordEntries([ticketSale(), ticketSale({ occurredAt: DEC, subjectId: 'tkt-2' })]);
		expect(await totalsByKindAndCategory(JANUARY)).toEqual([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 300 }
		]);
	});

	it('narrows to the projects asked for', async () => {
		await recordEntries([
			ticketSale({ projectId: 'p-mine' }),
			ticketSale({ projectId: 'p-other', subjectId: 'tkt-2', amountCents: 900 }),
			ticketSale({ subjectId: 'tkt-3', amountCents: 5000 })
		]);
		expect(await totalsByKindAndCategory(YEAR, { projectIds: ['p-mine'] })).toEqual([
			{ kind: 'earned', category: 'ticket_sales', totalCents: 300 }
		]);
	});

	// An empty list is a committee with no projects, not "no filter".
	it('returns nothing for an empty project list', async () => {
		await recordEntries([ticketSale({ projectId: 'p-mine' })]);
		expect(await totalsByKindAndCategory(YEAR, { projectIds: [] })).toEqual([]);
	});
});

describe('where the record begins', () => {
	it('is null on an empty ledger, so a caller can tell that from a quiet year', async () => {
		expect(await ledgerStartsAt()).toBeNull();
	});

	it('is the oldest entry, whatever order they were written in', async () => {
		await recordEntries([
			ticketSale({ occurredAt: DEC }),
			ticketSale({ occurredAt: JAN, subjectId: 'tkt-2' }),
			ticketSale({ occurredAt: FEB, subjectId: 'tkt-3' })
		]);
		expect(await ledgerStartsAt()).toEqual(JAN);
	});
});
