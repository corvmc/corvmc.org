import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * When a show's costs reach the ledger, and why not sooner.
 *
 * The decision #1173 records: a cost sheet is a worksheet until the night is
 * settled, so posting at settlement is what makes `occurredAt` honest.
 */

const recordEntries = vi.fn<(inputs: Record<string, unknown>[]) => Promise<void>>(
	async () => undefined
);
const reverseEntriesForSubject = vi.fn(async () => 0);
let posted: Record<string, unknown[]> = {};
// A show's ledger rows name its project (production-projects-spec.md); resolving
// one is a read with its own home, so here it is a fixed answer.
vi.mock('./show-project', () => ({
	showProjectIdForEvent: async (eventId: string | null) => (eventId ? 'proj-show' : null),
	showProjectIdForProduction: async () => 'proj-show'
}));
vi.mock('./financial-entry-service', () => ({
	recordEntries: (...a: unknown[]) => recordEntries(...(a as [Record<string, unknown>[]])),
	reverseEntriesForSubject: (...a: unknown[]) => reverseEntriesForSubject(...(a as [])),
	listForSubject: async (_type: string, id: string) => posted[id] ?? []
}));

let lines: Record<string, unknown>[] = [];
vi.mock('$lib/server/production/expense-service', () => ({
	expenseLines: async () => lines
}));

const { postProductionExpenses, reverseProductionExpense } =
	await import('./production-expense-entries');

const line = (over: Record<string, unknown> = {}) => ({
	id: 'exp-1',
	label: 'Sound engineer',
	category: 'sound',
	amountCents: 15_000,
	deductible: true,
	paidTo: null,
	...over
});

const written = () => recordEntries.mock.calls[0]?.[0] ?? [];

beforeEach(() => {
	vi.clearAllMocks();
	posted = {};
	lines = [line()];
});

describe('posting a settled show', () => {
	it('spends each line under the show-costs category', async () => {
		await postProductionExpenses('prod-1', 'evt-1');

		expect(written()[0]).toMatchObject({
			amountCents: -15_000,
			kind: 'spent',
			category: 'production',
			settlement: 'cash',
			subjectType: 'production_expense',
			subjectId: 'exp-1',
			settlementGroup: 'evt-1'
		});
	});

	it("keeps the cost sheet's own category, which the chart of accounts has no room for", async () => {
		await postProductionExpenses('prod-1', 'evt-1');
		expect(written()[0].metadata).toMatchObject({ category: 'sound', deductible: true });
	});

	it('posts a line once, so a later transition adds only what is new', async () => {
		// `closed` runs this again after `settled`, which is how a line added in
		// between is picked up rather than skipped.
		posted = { 'exp-1': [{ id: 'entry-1' }] };
		lines = [line(), line({ id: 'exp-2', label: 'Door staff', amountCents: 8000 })];

		await postProductionExpenses('prod-1', 'evt-1');

		expect(written()).toHaveLength(1);
		expect(written()[0]).toMatchObject({ subjectId: 'exp-2' });
	});

	it('writes nothing for a show with no costs', async () => {
		lines = [];
		await postProductionExpenses('prod-1', 'evt-1');
		expect(recordEntries).not.toHaveBeenCalled();
	});

	it('names who was paid when the line says', async () => {
		lines = [line({ paidTo: 'Jo Nakamura' })];
		await postProductionExpenses('prod-1', 'evt-1');
		expect(written()[0].description).toBe('Sound engineer — Jo Nakamura');
	});
});

describe('removing a line after settlement', () => {
	it('reverses on the line, so the other lines are untouched', async () => {
		await reverseProductionExpense('exp-1');
		expect(reverseEntriesForSubject).toHaveBeenCalledWith('production_expense', 'exp-1');
	});
});
