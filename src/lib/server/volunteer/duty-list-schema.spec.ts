/**
 * The duty-list constraints, against real SQLite on the real migrated tables.
 *
 * Three of them cannot be checked any other way. `duty_list_item_one_shape` and
 * `work_task_done_has_time` are written as null-ness comparisons on purpose —
 * **SQLite passes a CHECK that evaluates to NULL**, so the obvious spelling
 * (`(a is null and b is null) or b > a`) lets one-set-one-null through as
 * `false OR NULL`. Whether the form actually rejects is a question for the
 * engine, not for the type checker or a mocked query. And `work_task`'s cascade
 * is a statement about what happens to a checklist when its work order is
 * deleted, which only a database can answer.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { drizzle as drizzleNode } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

let db: DatabaseSync;

/**
 * 30s, not the 10s default: this replays every committed migration, so it gets
 * monotonically slower with each one added and lands near the default ceiling
 * under parallel load.
 */
beforeAll(() => {
	db = new DatabaseSync(':memory:');
	migrate(drizzleNode({ client: db }), { migrationsFolder: MIGRATIONS_FOLDER });

	db.exec(`INSERT INTO user (id, name, email, email_verified)
	         VALUES ('u1', 'Tester', 't@example.com', 1)`);
	db.exec(`INSERT INTO volunteer_role (id, name) VALUES ('role-1', 'Tear Down')`);
	db.exec(`INSERT INTO duty_list (id, name, anchor) VALUES ('dl-1', 'Standard Show', 'doors')`);
}, 30_000);

afterAll(() => db?.close());

function insertItem(cols: string, vals: string) {
	db.exec(
		`INSERT INTO duty_list_item (id, duty_list_id, volunteer_role_id, ${cols})
		 VALUES ('${crypto.randomUUID()}', 'dl-1', 'role-1', ${vals})`
	);
}

describe('duty_list_item shape constraints', () => {
	it('accepts a windowed item — an offset and a duration', () => {
		expect(() => insertItem('offset_minutes, duration_minutes', '-30, 240')).not.toThrow();
	});

	it('accepts a deadline item — a due offset and no window', () => {
		expect(() => insertItem('due_offset_minutes', '-10080')).not.toThrow();
	});

	it('rejects an offset with no duration', () => {
		// The case the null-safe CHECK exists for: the naive spelling would
		// evaluate to `false OR NULL` here, and SQLite would let it through.
		expect(() => insertItem('offset_minutes', '-30')).toThrow(/constraint/i);
	});

	it('rejects a duration with no offset', () => {
		expect(() => insertItem('duration_minutes', '240')).toThrow(/constraint/i);
	});

	it('rejects an item that is both scheduled and due', () => {
		expect(() =>
			insertItem('offset_minutes, duration_minutes, due_offset_minutes', '-30, 240, -10080')
		).toThrow(/constraint/i);
	});

	it('rejects an item that is neither', () => {
		expect(() => insertItem('capacity', '1')).toThrow(/constraint/i);
	});

	it('rejects a zero or negative duration', () => {
		expect(() => insertItem('offset_minutes, duration_minutes', '-30, 0')).toThrow(/constraint/i);
	});

	it('rejects a capacity below one', () => {
		expect(() => insertItem('offset_minutes, duration_minutes, capacity', '-30, 240, 0')).toThrow(
			/constraint/i
		);
	});
});

describe('work_task', () => {
	beforeAll(() => {
		db.exec(`INSERT INTO volunteer_shift (id, volunteer_role_id, capacity)
		         VALUES ('wo-1', 'role-1', 1)`);
	});

	it('accepts an unticked task with no done_at', () => {
		expect(() =>
			db.exec(`INSERT INTO work_task (id, work_order_id, label) VALUES ('t1', 'wo-1', 'Trash out')`)
		).not.toThrow();
	});

	it('rejects a ticked task with no done_at', () => {
		expect(() =>
			db.exec(
				`INSERT INTO work_task (id, work_order_id, label, done) VALUES ('t2', 'wo-1', 'Sweep', 1)`
			)
		).toThrow(/constraint/i);
	});

	it('rejects an unticked task that still carries a done_at', () => {
		expect(() =>
			db.exec(
				`INSERT INTO work_task (id, work_order_id, label, done, done_at)
				 VALUES ('t3', 'wo-1', 'Stack chairs', 0, 1750000000)`
			)
		).toThrow(/constraint/i);
	});

	it('keeps the task when the person who ticked it is deleted', () => {
		db.exec(`INSERT INTO work_task (id, work_order_id, label, done, done_at, done_by_user_id)
		         VALUES ('t4', 'wo-1', 'Lock up', 1, 1750000000, 'u1')`);
		db.exec(`PRAGMA foreign_keys = ON`);
		db.exec(`DELETE FROM user WHERE id = 'u1'`);

		const [row] = db
			.prepare(`SELECT done, done_by_user_id FROM work_task WHERE id = 't4'`)
			.all() as {
			done: number;
			done_by_user_id: string | null;
		}[];

		// Set-null, not cascade — which is exactly why the CHECK constrains
		// `done_at` and not `done_by_user_id`. A ticked task has to stay
		// representable after the account that ticked it is gone.
		expect(row.done).toBe(1);
		expect(row.done_by_user_id).toBeNull();
	});

	it('deletes its tasks when the work order goes', () => {
		db.exec(`PRAGMA foreign_keys = ON`);
		db.exec(`DELETE FROM volunteer_shift WHERE id = 'wo-1'`);

		const rows = db.prepare(`SELECT id FROM work_task WHERE work_order_id = 'wo-1'`).all();
		expect(rows).toHaveLength(0);
	});
});
