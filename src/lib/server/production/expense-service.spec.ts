import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The expense aggregates, against a real SQLite.
 *
 * `SUM` with a `WHERE deductible` is the whole point — a mocked `db` would
 * agree with the filter whether or not it were there.
 */

const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	/**
	 * The `CREATE TABLE` from whichever migration last created it, plus any later
	 * `ALTER TABLE … ADD`. Replaying the ALTERs is what keeps this tracking the
	 * schema rather than a fossil — see `inventory/reports.spec.ts`, which
	 * established the pattern and explains the quiet failure it avoids.
	 */
	function ddlFor(table: string): string[] {
		const marker = `CREATE TABLE \`${table}\``;
		const files = globSync('migrations/*/migration.sql').sort();
		const createdIn = files.filter((f: string) => readFileSync(f, 'utf8').includes(marker)).pop();
		if (!createdIn) throw new Error(`no migration creates ${table}`);

		const statementsIn = (file: string) =>
			readFileSync(file, 'utf8')
				.split('--> statement-breakpoint')
				.map((c: string) => c.trim().replace(/;$/, ''))
				.filter(Boolean);

		const create = statementsIn(createdIn).find((c: string) => c.startsWith(marker));
		if (!create) throw new Error(`no CREATE TABLE statement for ${table} in ${createdIn}`);

		const alterMarker = `ALTER TABLE \`${table}\` ADD`;
		const alters = files
			.slice(files.indexOf(createdIn) + 1)
			.flatMap(statementsIn)
			.filter((c: string) => c.startsWith(alterMarker));

		return [create, ...alters];
	}

	const sqlite = new Database(':memory:');
	// The DDL carries foreign keys into `user`, which this spec has no reason to
	// create — it is testing aggregation, not referential integrity. better-sqlite3
	// turns enforcement on by default, so turn it back off rather than seeding a
	// user table that no assertion reads.
	sqlite.pragma('foreign_keys = OFF');

	for (const t of ['production_expense']) {
		for (const stmt of ddlFor(t)) sqlite.exec(stmt);
	}

	// `drizzle({ client })`, not `drizzle(client)`. drizzle 1.0 dropped the
	// positional overload: a raw Database passed positionally is read as a
	// *config* object, finds no client in it, and quietly opens a second, empty
	// database — so every query answers "no such table" against tables that
	// demonstrably exist on `sqlite`.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { addExpense, deductibleTotalCents, listExpenses, removeExpense, shareBaseCents } =
	await import('./expense-service');

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
