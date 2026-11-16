/**
 * #2731 wrote a collective ticket's card fee twice. The migration appends
 * correcting rows for each payment short by exactly its fee. Seeded with the
 * four production shapes and the payments it must leave alone, then run twice.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) => n.endsWith('_ticket_fee_correction'));
const SQL = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function run(db: DatabaseSync) {
	for (const statement of SQL.split('--> statement-breakpoint')) db.exec(statement);
}

let n = 0;
function entry(
	db: DatabaseSync,
	subject: string,
	amount: number,
	kind: string,
	category: string,
	metadata: string | null = null
) {
	db.prepare(
		`INSERT INTO financial_entry (id, amount_cents, kind, category, occurred_at, settlement,
			stripe_payment_record_id, subject_type, subject_id, description, metadata)
		 VALUES (?, ?, ?, ?, 1790000000, 'stripe', ?, 'ticket', ?, 'x', ?)`
	).run(`fe-${n++}`, amount, kind, category, `pi_${subject}`, subject, metadata);
}

function tickets(
	db: DatabaseSync,
	purchase: string,
	units: number[],
	contribution = 0,
	covered = 0
) {
	units.forEach((unit, i) =>
		db
			.prepare(
				`INSERT INTO ticket (id, event_id, purchase_id, code, attendee_name, attendee_email,
					status, unit_price_cents, contribution_cents, fee_covered_cents)
				 VALUES (?, 'evt', ?, ?, 'A', 'a@example.com', 'valid', ?, ?, ?)`
			)
			.run(
				`${purchase}-${i}`,
				purchase,
				`${purchase}-${i}`,
				unit,
				i === 0 ? contribution : 0,
				i === 0 ? covered : 0
			)
	);
}

/** The old writer: the split's after-fee share earned, and the fee spent again. */
function oldSale(
	db: DatabaseSync,
	purchase: string,
	collective: number,
	acts: number,
	fee: number
) {
	entry(db, purchase, collective, 'earned', 'ticket_sales');
	entry(db, purchase, acts, 'pass_through', 'act_payout');
	entry(db, purchase, -fee, 'spent', 'card_fees');
}

const sumOf = (db: DatabaseSync, subject: string) =>
	(
		db
			.prepare('SELECT sum(amount_cents) AS s FROM financial_entry WHERE subject_id = ?')
			.get(subject) as { s: number }
	).s;

const corrections = (db: DatabaseSync, subject: string) =>
	db
		.prepare(
			`SELECT category, amount_cents AS a, kind FROM financial_entry
			  WHERE subject_id = ? AND json_extract(metadata, '$.correction') = 2731 ORDER BY category`
		)
		.all(subject) as Array<{ category: string; a: number; kind: string }>;

describe('ticket card fee correction', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-ticket-fee-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec('PRAGMA foreign_keys = OFF');

		tickets(db, 'plain', [1000]);
		oldSale(db, 'plain', 241, 700, 59);

		tickets(db, 'covered', [1000, 1000], 0, 91);
		oldSale(db, 'covered', 600, 1400, 91);

		// Already right, as the fixed writer records it.
		tickets(db, 'fixed', [1000]);
		entry(db, 'fixed', 300, 'earned', 'ticket_sales');
		entry(db, 'fixed', 700, 'pass_through', 'act_payout');
		entry(db, 'fixed', -59, 'spent', 'card_fees');

		// Refunded: the reversal nets it to zero, which is not this bug.
		tickets(db, 'refunded', [1000]);
		oldSale(db, 'refunded', 241, 700, 59);
		entry(db, 'refunded', -241, 'earned', 'ticket_sales', '{"reversalOf":"x"}');

		// Backfilled from Stripe: no fee row at all.
		tickets(db, 'backfilled', [1000]);
		entry(db, 'backfilled', 300, 'earned', 'ticket_sales', '{"source":"stripe"}');
		entry(db, 'backfilled', 700, 'pass_through', 'act_payout', '{"source":"stripe"}');

		run(db);
		run(db);
	});

	it('brings a payment to the charge less one fee', () => {
		expect(sumOf(db, 'plain')).toBe(1000 - 59);
		expect(corrections(db, 'plain')).toEqual([{ category: 'ticket_sales', a: 59, kind: 'earned' }]);
	});

	it('restores the covered fee as fee coverage', () => {
		expect(sumOf(db, 'covered')).toBe(2091 - 91);
		expect(corrections(db, 'covered')).toEqual([
			{ category: 'fee_coverage', a: 91, kind: 'earned' }
		]);
	});

	it('leaves right, refunded and backfilled payments alone', () => {
		for (const subject of ['fixed', 'refunded', 'backfilled'])
			expect(corrections(db, subject)).toEqual([]);
	});

	it('writes nothing on a second run', () => {
		const count = db
			.prepare(
				`SELECT count(*) AS c FROM financial_entry WHERE json_extract(metadata, '$.correction') = 2731`
			)
			.get() as { c: number };
		expect(count.c).toBe(2);
	});
});
