import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import Database from 'better-sqlite3';

const SQL = readFileSync('scripts/db/backfill/financial-entries.sql', 'utf8');
/** Comments first: the header prose contains semicolons of its own. */
const CODE = SQL.replace(/^\s*--.*$/gm, '');

/** DDL from the generated migration, so this tracks the schema rather than a copy. */
function migrationDdl(table: string): string[] {
	const marker = `CREATE TABLE \`${table}\``;
	const file = globSync('migrations/*/migration.sql')
		.sort()
		.find((f) => readFileSync(f, 'utf8').includes(marker));
	if (!file) throw new Error(`no migration creates ${table}`);
	return readFileSync(file, 'utf8')
		.split('--> statement-breakpoint')
		.map((c) => c.trim())
		.filter((c) => c.includes(marker));
}

/**
 * Only the columns the backfill reads. Hand-written: these are the sources.
 *
 * `user` and `project` are stubs for the two real foreign keys on
 * `financial_entry` — this is testing reconstruction, not referential
 * integrity, and the migration's DDL names them.
 */
const SOURCE_DDL = [
	`CREATE TABLE user (id text PRIMARY KEY)`,
	`CREATE TABLE project (id text PRIMARY KEY)`,
	`CREATE TABLE ticket (
		id text PRIMARY KEY, event_id text NOT NULL, purchase_id text NOT NULL, user_id text,
		status text NOT NULL DEFAULT 'valid', stripe_payment_record_id text,
		acts_cents integer NOT NULL DEFAULT 0, collective_cents integer NOT NULL DEFAULT 0,
		fee_covered_cents integer NOT NULL DEFAULT 0,
		created_at integer NOT NULL DEFAULT (unixepoch())
	)`,
	`CREATE TABLE reservation (
		id text PRIMARY KEY, created_by_user_id text NOT NULL, status text NOT NULL,
		starts_at integer NOT NULL, paid_at integer, stripe_payment_record_id text,
		credits_used real, cash_due_cents integer
	)`,
	`CREATE TABLE acquisition (
		id text PRIMARY KEY, kind text NOT NULL, occurred_at integer NOT NULL,
		donor_user_id text, fair_value_cents integer
	)`
];

let sqlite: Database.Database;
const run = () => sqlite.exec(CODE);
const entries = () =>
	sqlite.prepare('select * from financial_entry').all() as Record<string, unknown>[];

beforeEach(() => {
	sqlite = new Database(':memory:');
	for (const stmt of migrationDdl('financial_entry')) sqlite.exec(stmt);
	for (const stmt of SOURCE_DDL) sqlite.exec(stmt);
	// The two real foreign keys stay enforced rather than switched off — a
	// backfill that pointed at a missing member would be a genuine defect.
	sqlite.exec(`insert into user (id) values ('u1')`);
});

describe('financial entry backfill', () => {
	it('reconstructs a ticket sale as the collective share and the acts pool', () => {
		sqlite.exec(`
			insert into ticket (id, event_id, purchase_id, user_id, status, stripe_payment_record_id,
				acts_cents, collective_cents, created_at)
			values ('t1','evt-1','pur-1','u1','valid','pr_1',700,300,1000),
			       ('t2','evt-1','pur-1','u1','valid','pr_1',700,300,1000)
		`);

		run();

		const rows = entries();
		expect(rows).toHaveLength(2);
		// One sale of two tickets is one transaction, not two.
		expect(rows.find((r) => r.kind === 'earned')?.amount_cents).toBe(600);
		expect(rows.find((r) => r.kind === 'pass_through')?.amount_cents).toBe(1400);
		expect(rows.find((r) => r.kind === 'pass_through')?.settlement_group).toBe('evt-1');
	});

	it('skips a pending or cancelled ticket', () => {
		sqlite.exec(`
			insert into ticket (id, event_id, purchase_id, status, collective_cents, created_at)
			values ('t1','evt-1','pur-1','pending',300,1000),
			       ('t2','evt-1','pur-2','cancelled',300,1000)
		`);

		run();

		expect(entries()).toHaveLength(0);
	});

	it('splits a part-credit reservation into its two settlements', () => {
		sqlite.exec(`
			insert into reservation (id, created_by_user_id, status, starts_at, paid_at,
				credits_used, cash_due_cents)
			values ('r1','u1','completed',1000,1200,4,500)
		`);

		run();

		const rows = entries();
		expect(rows).toHaveLength(2);

		const cash = rows.find((r) => r.settlement === 'cash');
		expect(cash?.amount_cents).toBe(500);
		// When the money moved, not when the row was written.
		expect(cash?.occurred_at).toBe(1200);

		// Four credits at 750 — half the $15 hourly rate, per the constant.
		const credit = rows.find((r) => r.settlement === 'credit');
		expect(credit?.amount_cents).toBe(3000);
		expect(credit?.subject_id).toBe('r1:credit');
	});

	// Wholly credit-covered: no cash row at all, and the credit row carries the
	// whole value. The rate has never moved, so valuing at today's is exact.
	it('writes only the credit half when no cash was owed', () => {
		sqlite.exec(`
			insert into reservation (id, created_by_user_id, status, starts_at, credits_used, cash_due_cents)
			values ('r1','u1','confirmed',1000,6,0)
		`);

		run();

		const rows = entries();
		expect(rows).toHaveLength(1);
		expect(rows[0].settlement).toBe('credit');
		expect(rows[0].amount_cents).toBe(4500);
	});

	it('reconstructs a valued gift and skips an unvalued one', () => {
		sqlite.exec(`
			insert into acquisition (id, kind, occurred_at, donor_user_id, fair_value_cents)
			values ('a1','donation',900,'u1',8240),
			       ('a2','donation',900,'u1',null),
			       ('a3','purchase',900,null,5000)
		`);

		run();

		const rows = entries();
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('in_kind');
		expect(rows[0].amount_cents).toBe(8240);
	});

	/**
	 * D1 has no transactions, so idempotence is the safety property — a run that
	 * half-applies gets run again, and a second full run must change nothing.
	 */
	it('is a no-op on a second run', () => {
		sqlite.exec(`
			insert into ticket (id, event_id, purchase_id, status, acts_cents, collective_cents, created_at)
			values ('t1','evt-1','pur-1','valid',700,300,1000);
			insert into reservation (id, created_by_user_id, status, starts_at, cash_due_cents)
			values ('r1','u1','completed',1000,500);
			insert into acquisition (id, kind, occurred_at, fair_value_cents)
			values ('a1','donation',900,8240)
		`);

		run();
		const first = entries();
		run();

		expect(entries()).toHaveLength(first.length);
	});

	it('marks every row as backfilled', () => {
		sqlite.exec(`
			insert into ticket (id, event_id, purchase_id, status, acts_cents, collective_cents, created_at)
			values ('t1','evt-1','pur-1','valid',700,300,1000)
		`);

		run();

		for (const row of entries()) {
			expect(JSON.parse(String(row.metadata)).backfilled).toBe(true);
		}
	});
});
