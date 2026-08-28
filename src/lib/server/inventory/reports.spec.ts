import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The reporting queries, run against a real SQLite.
 *
 * Named for what it covers rather than for a module: there is no `reports.ts`.
 * `spendByCategory` and `inKindContributions` live in `acquisition-service.ts`
 * and `listForm8282Obligations` in `asset-service.ts`, but all three are
 * aggregate SQL that wants a database rather than the mocked `db` their
 * neighbours use.
 *
 * Every other spec in this folder mocks `$lib/server/db`, which is right for
 * lifecycle logic — it isolates the rules from the storage. It is **wrong for
 * these**: they are four-table joins with `GROUP BY` and `SUM`, and a mocked
 * `db` returns whatever the test told it to, so it agrees with any `WHERE`
 * clause, right or wrong. All three shipped with no coverage of the SQL itself.
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

	/**
	 * Every statement needed to build one table as it stands today: the
	 * `CREATE TABLE` from whichever migration last created it, followed by any
	 * `ALTER TABLE … ADD` from the migrations after that one.
	 *
	 * The `CREATE` alone is not enough, and the failure is quiet in the worst
	 * way: an additive migration leaves this spec building a table that is one
	 * column short of production, so a query reading the new column fails with
	 * `no such column` — pointing at the test harness rather than at the schema
	 * drift that actually caused it. Replaying the ALTERs is what makes the
	 * "tracks the schema rather than a fossil of it" claim above true.
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

	for (const t of [
		'equipment_category',
		'inventory_item',
		'inventory_asset',
		'acquisition',
		'acquisition_line',
		'stock_movement',
		// Left-joined by `listForm8282Obligations` to name the donor.
		'user'
	]) {
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

const { spendByCategory, inKindContributions } = await import('./acquisition-service');
const { listForm8282Obligations } = await import('./asset-service');

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

const JAN = new Date('2026-01-15T00:00:00Z');
const JUN = new Date('2026-06-15T00:00:00Z');
const NEXT_YEAR = new Date('2027-02-01T00:00:00Z');
const YEAR_START = new Date('2026-01-01T00:00:00Z');
const YEAR_END = new Date('2026-12-31T23:59:59Z');

function reset() {
	for (const t of [
		'acquisition_line',
		'inventory_asset',
		'acquisition',
		'inventory_item',
		'equipment_category',
		'user'
	]) {
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
	const acknowledgedAt = extra.acknowledgedAt as Date | undefined;
	sqlite
		.prepare(
			`INSERT INTO acquisition
			   (id, kind, occurred_at, source_name, monetized, acknowledged_at, donor_user_id,
			    fair_value_cents, paid_by_user_id, reimbursed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			kind,
			secs(at),
			(extra.sourceName as string) ?? null,
			monetized,
			acknowledgedAt ? secs(acknowledgedAt) : null,
			(extra.donorUserId as string) ?? null,
			(extra.fairValueCents as number) ?? null,
			(extra.paidByUserId as string) ?? null,
			extra.reimbursedAt ? secs(extra.reimbursedAt as Date) : null
		);
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

/**
 * The SQL half of the Form 8282 rule.
 *
 * `form-8282.spec.ts` pins the date arithmetic exhaustively against a pure
 * function, and it is right to. What it cannot see is the query that decides
 * *which rows reach that function* — donated, disposed, unresolved, and split on
 * whether a Form 8283 was signed. That narrowing is the whole substance of #309
 * and had no unit coverage at all: a mocked `db` returns the rows the test named
 * and so agrees with any `WHERE` clause, right or wrong.
 */
describe('listForm8282Obligations', () => {
	const DONATED_AT = new Date('2026-01-10T00:00:00Z');
	/** Inside the three years, and inside the 125 days. */
	const DISPOSED_AT = new Date('2026-07-01T00:00:00Z');
	const NOW = new Date('2026-08-01T00:00:00Z');

	function donor(id: string, name: string) {
		sqlite
			.prepare(
				`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
				 VALUES (?, ?, ?, 0, ?, ?)`
			)
			.run(id, name, `${id}@example.com`, secs(DONATED_AT), secs(DONATED_AT));
	}

	function unit(
		id: string,
		acqId: string | null,
		opts: { retiredAt?: Date | null; resolvedAt?: Date | null } = {}
	) {
		sqlite
			.prepare(
				`INSERT INTO inventory_asset
				   (id, item_id, condition, status, acquisition_id, retired_at, form_8282_resolved_at)
				 VALUES (?, 'it-amp', 'good', ?, ?, ?, ?)`
			)
			.run(
				id,
				opts.retiredAt ? 'retired' : 'in_service',
				acqId,
				opts.retiredAt ? secs(opts.retiredAt) : null,
				opts.resolvedAt ? secs(opts.resolvedAt) : null
			);
	}

	/** A donation with a signed 8283, disposed of inside the window. */
	function reportableGift(acqId: string, assetId: string) {
		acquisition(acqId, 'donation', DONATED_AT, { acknowledgedAt: DONATED_AT });
		unit(assetId, acqId, { retiredAt: DISPOSED_AT });
	}

	it('lists a signed-for gift disposed of inside three years', async () => {
		donor('u-1', 'Dana Reyes');
		acquisition('a1', 'donation', DONATED_AT, {
			acknowledgedAt: DONATED_AT,
			donorUserId: 'u-1',
			fairValueCents: 600_000
		});
		unit('as-1', 'a1', { retiredAt: DISPOSED_AT });

		const { obligations, noFormOnRecord } = await listForm8282Obligations(NOW);

		expect(obligations).toHaveLength(1);
		expect(obligations[0].id).toBe('as-1');
		expect(obligations[0].donor).toBe('Dana Reyes');
		expect(obligations[0].fairValueCents).toBe(600_000);
		expect(obligations[0].status.state).toBe('due');
		expect(noFormOnRecord).toBe(0);
	});

	/**
	 * The #309 correction, and the one that matters most for CMC: it has never
	 * signed an 8283, so before this the page was nothing but false positives.
	 */
	it('counts an unsigned gift instead of listing it', async () => {
		acquisition('a1', 'donation', DONATED_AT);
		unit('as-1', 'a1', { retiredAt: DISPOSED_AT });

		const { obligations, noFormOnRecord } = await listForm8282Obligations(NOW);

		expect(obligations).toEqual([]);
		expect(noFormOnRecord).toBe(1);
	});

	it('ignores a purchase, however it was disposed of', async () => {
		acquisition('a1', 'purchase', DONATED_AT, { acknowledgedAt: DONATED_AT });
		unit('as-1', 'a1', { retiredAt: DISPOSED_AT });

		const { obligations, noFormOnRecord } = await listForm8282Obligations(NOW);
		expect(obligations).toEqual([]);
		expect(noFormOnRecord).toBe(0);
	});

	it('ignores a gift still in service — nothing is owed until it goes', async () => {
		acquisition('a1', 'donation', DONATED_AT, { acknowledgedAt: DONATED_AT });
		unit('as-1', 'a1');

		const { obligations, noFormOnRecord } = await listForm8282Obligations(NOW);
		expect(obligations).toEqual([]);
		expect(noFormOnRecord).toBe(0);
	});

	it('drops one somebody has already recorded an outcome for', async () => {
		acquisition('a1', 'donation', DONATED_AT, { acknowledgedAt: DONATED_AT });
		unit('as-1', 'a1', { retiredAt: DISPOSED_AT, resolvedAt: NOW });

		const { obligations, noFormOnRecord } = await listForm8282Obligations(NOW);
		expect(obligations).toEqual([]);
		// Resolved rows leave the query entirely, so they do not inflate the
		// "nothing outstanding" denominator either.
		expect(noFormOnRecord).toBe(0);
	});

	/**
	 * A unit entered by hand rather than received has no acquisition, so the
	 * system cannot know it was a gift. An `innerJoin` is what makes that a
	 * silent exclusion rather than a crash.
	 */
	it('ignores a unit with no acquisition behind it', async () => {
		unit('as-1', null, { retiredAt: DISPOSED_AT });

		const { obligations, noFormOnRecord } = await listForm8282Obligations(NOW);
		expect(obligations).toEqual([]);
		expect(noFormOnRecord).toBe(0);
	});

	it('falls back to the free-text source when the donor is not a member', async () => {
		acquisition('a1', 'donation', DONATED_AT, {
			acknowledgedAt: DONATED_AT,
			sourceName: 'Corvallis Rotary'
		});
		unit('as-1', 'a1', { retiredAt: DISPOSED_AT });

		const { obligations } = await listForm8282Obligations(NOW);
		expect(obligations[0].donor).toBe('Corvallis Rotary');
	});

	/** Soonest deadline first, so the one about to lapse is not below the fold. */
	it('sorts by deadline, soonest first', async () => {
		reportableGift('a1', 'as-late');
		sqlite
			.prepare(`UPDATE inventory_asset SET retired_at = ? WHERE id = 'as-late'`)
			.run(secs(new Date('2026-07-20T00:00:00Z')));
		reportableGift('a2', 'as-early');
		sqlite
			.prepare(`UPDATE inventory_asset SET retired_at = ? WHERE id = 'as-early'`)
			.run(secs(new Date('2026-06-01T00:00:00Z')));

		const { obligations } = await listForm8282Obligations(NOW);
		expect(obligations.map((o) => o.id)).toEqual(['as-early', 'as-late']);
	});
});
