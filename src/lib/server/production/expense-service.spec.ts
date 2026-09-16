import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The expense aggregates, against a real SQLite.
 *
 * `SUM` with a `WHERE deductible` is the whole point — a mocked `db` would
 * agree with the filter whether or not it were there.
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
	addExpense,
	deductibleTotalCents,
	expenseLines,
	listExpenses,
	removeExpense,
	shareBaseCents
} = await import('./expense-service');

const forShow = (over: Record<string, unknown> = {}) => ({
	productionId: 'prod-1',
	label: 'Sound engineer',
	category: 'sound' as const,
	amountCents: 15_000,
	...over
});

beforeEach(() => sqlite.exec('delete from production_expense'));

describe('recording what a show cost', () => {
	it('defaults a line to deductible, because most costs come off the door', async () => {
		await addExpense(forShow());
		const [row] = await listExpenses('prod-1');
		expect(row.deductible).toBe(true);
		expect(row.amountCents).toBe(15_000);
	});

	it('keeps lines for one show out of another\u2019s total', async () => {
		await addExpense(forShow());
		await addExpense(forShow({ productionId: 'prod-2', amountCents: 99_000 }));
		expect(await deductibleTotalCents('prod-1')).toBe(15_000);
	});

	it('removes a line', async () => {
		const id = await addExpense(forShow());
		await removeExpense(id);
		expect(await listExpenses('prod-1')).toHaveLength(0);
	});
});

describe('the cost sheet the worksheet reads', () => {
	it('carries both totals, so a deductible line and a carried one stay apart', async () => {
		// The settlement derives expensesCents and deductibleExpensesCents from
		// this one list rather than from the ledger's `spent` rows, which also hold
		// the guarantee top-ups that netCents already subtracts.
		await addExpense(forShow({ amountCents: 15_000 }));
		await addExpense(
			forShow({ label: 'PA insurance', category: 'other', amountCents: 12_000, deductible: false })
		);

		const lines = await expenseLines('prod-1');
		// Order-insensitive: both rows land in the same `unixepoch()` second and the
		// query names no tiebreaker, so which comes first is unspecified (#1196).
		// This asserted the order the index-less harness happened to produce.
		expect(lines.map((l) => l.label).sort()).toEqual(['PA insurance', 'Sound engineer']);
		expect(lines.reduce((t, l) => t + l.amountCents, 0)).toBe(27_000);
		expect(lines.filter((l) => l.deductible).reduce((t, l) => t + l.amountCents, 0)).toBe(15_000);
	});

	it('leaves out who recorded it and when, which the worksheet has no use for', async () => {
		await addExpense(forShow({ recordedByUserId: null, paidTo: 'Sam' }));
		const [line] = await expenseLines('prod-1');
		expect(Object.keys(line).sort()).toEqual([
			'amountCents',
			'category',
			'deductible',
			'id',
			'label',
			'paidTo'
		]);
		expect(line.paidTo).toBe('Sam');
	});
});

describe('what a percentage divides against', () => {
	it('is the whole door on a gross deal, expenses or not', async () => {
		await addExpense(forShow({ amountCents: 20_000 }));
		expect(
			await shareBaseCents({ productionId: 'prod-1', doorCents: 120_000, againstNet: false })
		).toBe(120_000);
	});

	it('is the door less deductible costs on a net deal', async () => {
		await addExpense(forShow({ amountCents: 15_000 }));
		await addExpense(forShow({ label: 'Door staff', category: 'staffing', amountCents: 8000 }));
		expect(
			await shareBaseCents({ productionId: 'prod-1', doorCents: 120_000, againstNet: true })
		).toBe(97_000);
	});

	it('leaves a non-deductible cost out of the act\u2019s share', async () => {
		// A cost the collective carries whatever happens is real spend, but it is
		// not the act's to share — which is the whole meaning of againstNet.
		await addExpense(forShow({ amountCents: 15_000 }));
		await addExpense(
			forShow({
				label: 'Annual PA insurance',
				category: 'other',
				amountCents: 40_000,
				deductible: false
			})
		);
		expect(
			await shareBaseCents({ productionId: 'prod-1', doorCents: 120_000, againstNet: true })
		).toBe(105_000);
	});

	it('never returns a negative base on a night that cost more than it took', async () => {
		// The acts get a share of nothing, not a share of a debt.
		await addExpense(forShow({ amountCents: 200_000 }));
		expect(
			await shareBaseCents({ productionId: 'prod-1', doorCents: 120_000, againstNet: true })
		).toBe(0);
	});

	it('is the door itself when nothing was spent', async () => {
		expect(
			await shareBaseCents({ productionId: 'prod-1', doorCents: 120_000, againstNet: true })
		).toBe(120_000);
	});
});
