import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The financial record's aggregates, against a real SQLite.
 *
 * `SUM` and `GROUP BY` over a signed column: a mocked `db` returns whatever the
 * test told it to and agrees with any `WHERE`. DDL comes from the migration.
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

	for (const t of ['financial_entry']) {
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

const {
	listForSubject,
	poolBalanceCents,
	recordEntries,
	recordEntry,
	stripeSettledCents,
	totalEarnedCents,
	totalsByCategory
} = await import('./financial-entry-service');

const JAN = new Date('2026-01-15T00:00:00Z');
const FEB = new Date('2026-02-15T00:00:00Z');
const DEC = new Date('2026-12-15T00:00:00Z');
const YEAR = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') };
const JANUARY = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T23:59:59Z') };

/** A $10 ticket at the default split, as the spec's worked example writes it. */
const ticketSale = (over: Partial<Parameters<typeof recordEntry>[0]> = {}) => ({
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
