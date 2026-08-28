import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The two reporting queries, run against a real SQLite.
 *
 * Every other spec in this folder mocks `$lib/server/db`, which is right for
 * lifecycle logic — it isolates the rules from the storage. It is **wrong for
 * these two**: `spendByCategory` and `inKindContributions` are four-table joins
 * with `GROUP BY` and `SUM`, and a mocked `db` returns whatever the test told it
 * to. It cannot tell you the grouping is wrong. Both queries shipped in Phase 1
 * as forward work with no coverage at all, so this is the first time either has
 * been executed.
 *
 * Follows the pattern `scripts/db/backfill/directory-entry.spec.ts` established:
 * the DDL is lifted out of the *generated migration* rather than hand-copied, so
 * this spec tracks the schema instead of a fossil of it.
 */

/**
 * The schema and the driver, hoisted so `vi.mock` can close over them.
 *
 * `vi.mock` is lifted above the imports, so anything it references has to be
 * built inside `vi.hoisted` — otherwise the factory runs before the database
 * exists.
 */
const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	/** The `CREATE TABLE` for one table, from whichever migration last created it. */
	function ddlFor(table: string): string {
		const marker = `CREATE TABLE \`${table}\``;
		const file = globSync('migrations/*/migration.sql')
			.sort()
			.reverse()
			.find((f: string) => readFileSync(f, 'utf8').includes(marker));
		if (!file) throw new Error(`no migration creates ${table}`);

		const stmt = readFileSync(file, 'utf8')
			.split('--> statement-breakpoint')
			.map((c: string) => c.trim())
			.find((c: string) => c.startsWith(marker));
		if (!stmt) throw new Error(`no CREATE TABLE statement for ${table} in ${file}`);
		return stmt.replace(/;$/, '');
	}

	const sqlite = new Database(':memory:');
	// The DDL carries foreign keys into `user`, which this spec has no reason to
	// create — it is testing aggregation, not referential integrity. better-sqlite3
	// turns enforcement on by default, so turn it back off rather than seeding a
	// user table that no assertion reads.
	sqlite.pragma('foreign_keys = OFF');

	for (const t of [
		'equipment_category',
		'inventory_item',
		'inventory_asset',
		'acquisition',
		'acquisition_line',
		'stock_movement'
	]) {
		sqlite.exec(ddlFor(t));
	}

	// `drizzle({ client })`, not `drizzle(client)`. drizzle 1.0 dropped the
	// positional overload: a raw Database passed positionally is read as a
	// *config* object, finds no client in it, and quietly opens a second, empty
	// database — so every query answers "no such table" against tables that
	// demonstrably exist on `sqlite`.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { spendByCategory, inKindContributions } = await import('./acquisition-service');

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

const JAN = new Date('2026-01-15T00:00:00Z');
const JUN = new Date('2026-06-15T00:00:00Z');
const NEXT_YEAR = new Date('2027-02-01T00:00:00Z');
const YEAR_START = new Date('2026-01-01T00:00:00Z');
const YEAR_END = new Date('2026-12-31T23:59:59Z');

function reset() {
	for (const t of ['acquisition_line', 'acquisition', 'inventory_item', 'equipment_category']) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
}

function seedCategories() {
	sqlite.exec(`
		INSERT INTO equipment_category (id, name, display_order, pricing_tier)
		VALUES ('cat-strings', 'Consumables', 0, 'accessory'),
		       ('cat-amps', 'Amplifiers', 1, 'major');
	`);
	sqlite.exec(`
		INSERT INTO inventory_item (id, name, category_id, kind, unit_of_measure, is_loanable)
		VALUES ('it-strings', 'Strings', 'cat-strings', 'bulk', 'pack', 0),
		       ('it-sticks', 'Sticks', 'cat-strings', 'bulk', 'pair', 0),
		       ('it-amp', 'Blues Deluxe', 'cat-amps', 'serialized', 'each', 1);
	`);
}

function acquisition(id: string, kind: string, at: Date, extra: Record<string, unknown> = {}) {
	const monetized = extra.monetized ?? 0;
	sqlite
		.prepare(
			`INSERT INTO acquisition (id, kind, occurred_at, source_name, monetized)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(id, kind, secs(at), (extra.sourceName as string) ?? null, monetized);
}

function line(id: string, acqId: string, itemId: string, qty: number, unitCents: number | null) {
	sqlite
		.prepare(
			`INSERT INTO acquisition_line (id, acquisition_id, item_id, quantity, unit_value_cents)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(id, acqId, itemId, qty, unitCents);
}

beforeEach(() => {
	reset();
	seedCategories();
});

describe('spendByCategory', () => {
	it('multiplies quantity by unit value and rolls up per category', async () => {
		acquisition('a1', 'purchase', JAN, { sourceName: 'Sweetwater' });
		line('l1', 'a1', 'it-strings', 12, 700); // 8400
		line('l2', 'a1', 'it-sticks', 10, 1100); // 11000
		line('l3', 'a1', 'it-amp', 1, 94_100); // 94100

		const rows = await spendByCategory(YEAR_START, YEAR_END);
		const byName = Object.fromEntries(rows.map((r) => [r.categoryName, r]));

		expect(Number(byName['Consumables'].totalCents)).toBe(8400 + 11000);
		expect(Number(byName['Consumables'].units)).toBe(22);
		expect(Number(byName['Amplifiers'].totalCents)).toBe(94_100);
		expect(Number(byName['Amplifiers'].units)).toBe(1);
	});

	it('sums across separate acquisitions in the window', async () => {
		acquisition('a1', 'purchase', JAN);
		line('l1', 'a1', 'it-strings', 12, 700);
		acquisition('a2', 'purchase', JUN);
		line('l2', 'a2', 'it-strings', 6, 800);

		const rows = await spendByCategory(YEAR_START, YEAR_END);
		expect(Number(rows[0].totalCents)).toBe(12 * 700 + 6 * 800);
	});

	/** The window is the whole point of a spend report; an off-by-one here would
	 *  quietly fold last year's purchases into this year's number. */
	it('excludes acquisitions outside the window', async () => {
		acquisition('a1', 'purchase', JAN);
		line('l1', 'a1', 'it-strings', 12, 700);
		acquisition('a2', 'purchase', NEXT_YEAR);
		line('l2', 'a2', 'it-strings', 999, 999);

		const rows = await spendByCategory(YEAR_START, YEAR_END);
		expect(Number(rows[0].totalCents)).toBe(8400);
	});

	it('counts an unpriced line as zero rather than dropping it', async () => {
		acquisition('a1', 'purchase', JAN);
		line('l1', 'a1', 'it-strings', 5, null);

		const rows = await spendByCategory(YEAR_START, YEAR_END);
		expect(Number(rows[0].totalCents)).toBe(0);
		// The units still happened even though nobody recorded a price.
		expect(Number(rows[0].units)).toBe(5);
	});

	/** Donations are not spend. Folding them in would overstate the budget by
	 *  exactly the value of everything the collective was given. */
	it('counts only purchases, not donations or grants', async () => {
		acquisition('a1', 'purchase', JAN);
		line('l1', 'a1', 'it-strings', 1, 100);
		acquisition('a2', 'donation', JAN);
		line('l2', 'a2', 'it-strings', 1, 50_000);
		acquisition('a3', 'grant', JAN);
		line('l3', 'a3', 'it-strings', 1, 90_000);

		const rows = await spendByCategory(YEAR_START, YEAR_END);
		expect(Number(rows[0].totalCents)).toBe(100);
	});

	it('reports the kind it was asked for', async () => {
		acquisition('a1', 'purchase', JAN);
		line('l1', 'a1', 'it-strings', 1, 100);
		acquisition('a2', 'grant', JAN);
		line('l2', 'a2', 'it-amp', 1, 48_000);

		const rows = await spendByCategory(YEAR_START, YEAR_END, 'grant');
		expect(rows).toHaveLength(1);
		expect(rows[0].categoryName).toBe('Amplifiers');
		expect(Number(rows[0].totalCents)).toBe(48_000);
	});

	it('is empty rather than throwing when nothing was bought', async () => {
		expect(await spendByCategory(YEAR_START, YEAR_END)).toEqual([]);
	});
});

describe('inKindContributions', () => {
	it('disaggregates gifts by category, which is what the disclosure asks for', async () => {
		acquisition('a1', 'donation', JAN);
		line('l1', 'a1', 'it-amp', 1, 250_000);
		acquisition('a2', 'donation', JUN);
		line('l2', 'a2', 'it-strings', 20, 700);

		const rows = await inKindContributions(YEAR_START, YEAR_END);
		const byName = Object.fromEntries(rows.map((r) => [r.categoryName, r]));

		expect(Number(byName['Amplifiers'].fairValueCents)).toBe(250_000);
		expect(Number(byName['Consumables'].fairValueCents)).toBe(14_000);
	});

	/** ASU 2020-07 wants monetized and utilized gifts told apart, so they cannot
	 *  share a row even within one category. */
	it('separates monetized from utilized within a category', async () => {
		acquisition('a1', 'donation', JAN, { monetized: 0 });
		line('l1', 'a1', 'it-amp', 1, 100_000);
		acquisition('a2', 'donation', JUN, { monetized: 1 });
		line('l2', 'a2', 'it-amp', 1, 60_000);

		const rows = await inKindContributions(YEAR_START, YEAR_END);
		const amps = rows.filter((r) => r.categoryName === 'Amplifiers');

		expect(amps).toHaveLength(2);
		expect(Number(amps.find((r) => !r.monetized)!.fairValueCents)).toBe(100_000);
		expect(Number(amps.find((r) => r.monetized)!.fairValueCents)).toBe(60_000);
	});

	it('excludes purchases and grants — only gifts are contributions', async () => {
		acquisition('a1', 'donation', JAN);
		line('l1', 'a1', 'it-amp', 1, 250_000);
		acquisition('a2', 'purchase', JAN);
		line('l2', 'a2', 'it-amp', 1, 94_100);
		acquisition('a3', 'grant', JAN);
		line('l3', 'a3', 'it-amp', 1, 48_000);

		const rows = await inKindContributions(YEAR_START, YEAR_END);
		expect(rows).toHaveLength(1);
		expect(Number(rows[0].fairValueCents)).toBe(250_000);
	});

	it('excludes gifts outside the reporting year', async () => {
		acquisition('a1', 'donation', JAN);
		line('l1', 'a1', 'it-amp', 1, 250_000);
		acquisition('a2', 'donation', NEXT_YEAR);
		line('l2', 'a2', 'it-amp', 1, 999_999);

		const rows = await inKindContributions(YEAR_START, YEAR_END);
		expect(Number(rows[0].fairValueCents)).toBe(250_000);
	});

	it('is empty rather than throwing in a year with no gifts', async () => {
		expect(await inKindContributions(YEAR_START, YEAR_END)).toEqual([]);
	});
});
