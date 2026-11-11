/**
 * #2518 copies each timed work order into one `volunteer_shift`. Runs the copy on a migrated
 * scratch file holding a timed, a cancelled and an untimed work order, then runs it again.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const dir = readdirSync(MIGRATIONS_FOLDER).find((n) =>
	n.endsWith('_timed_work_orders_become_shifts')
);
const COPY = readFileSync(join(MIGRATIONS_FOLDER, dir ?? 'missing', 'migration.sql'), 'utf8');

function runCopy(db: DatabaseSync) {
	for (const statement of COPY.split('--> statement-breakpoint')) db.exec(statement);
}

type Shift = {
	id: string;
	work_order_id: string;
	starts_at: number;
	ends_at: number;
	capacity: number;
	anchor: string | null;
	notes: string | null;
	cancelled_at: number | null;
};

const shifts = (db: DatabaseSync) =>
	db
		.prepare(
			`SELECT id, work_order_id, starts_at, ends_at, capacity, anchor, notes, cancelled_at
			 FROM volunteer_shift ORDER BY work_order_id`
		)
		.all() as Shift[];

describe('timed work orders become shifts', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-shift-copy-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		// The migration ran on empty tables; these rows stand in for production's.
		db.exec(`
			DELETE FROM volunteer_shift;
			INSERT INTO work_order (id, starts_at, ends_at, capacity, anchor, notes, cancelled_at) VALUES
				('day1', 1000, 5000, 3, 'doors', 'Side door', NULL),
				('day2', 9000, 12000, 1, NULL, NULL, 9500),
				('deliverable', NULL, NULL, 1, NULL, NULL, NULL);
			INSERT INTO work_order (id, due_at) VALUES ('due', 7000);
		`);
		runCopy(db);
	});

	it('gives each timed work order one shift carrying its times, places, anchor, notes and cancellation', () => {
		expect(shifts(db).map(({ id: _id, ...rest }) => rest)).toEqual([
			{
				work_order_id: 'day1',
				starts_at: 1000,
				ends_at: 5000,
				capacity: 3,
				anchor: 'doors',
				notes: 'Side door',
				cancelled_at: null
			},
			{
				work_order_id: 'day2',
				starts_at: 9000,
				ends_at: 12000,
				capacity: 1,
				anchor: null,
				notes: null,
				cancelled_at: 9500
			}
		]);
	});

	it('gives each shift its own UUID v4, leaving the task its id', () => {
		for (const s of shifts(db)) {
			expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			expect(s.id).not.toBe(s.work_order_id);
		}
	});

	it('adds nothing when run a second time', () => {
		const before = shifts(db);
		runCopy(db);
		expect(shifts(db)).toEqual(before);
	});
});
