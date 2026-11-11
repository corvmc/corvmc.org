/**
 * #2518 PR 2 moves `volunteer_signup.shift_id` and `volunteer_hour_log.shift_id` from
 * `work_order` to `volunteer_shift`. Seeds a scratch file at the migration before that,
 * then runs the prepare step and the rebuild each in one transaction, as D1 does, with
 * foreign keys enforced.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate-local';

const tags = readdirSync(MIGRATIONS_FOLDER);
const PREPARE = tags.find((n) => n.endsWith('_shift_signups_prepare')) ?? 'missing-prepare';
const REBUILD = tags.find((n) => n.endsWith('_signups_and_hours_name_shifts')) ?? 'missing-rebuild';

/** Every migration before the prepare step. */
function migrationsBeforePrepare(): string {
	const out = mkdtempSync(join(tmpdir(), 'corvmc-shift-fk-migrations-'));
	for (const tag of tags) {
		if (/^\d{14}_/.test(tag) && tag < PREPARE) {
			cpSync(join(MIGRATIONS_FOLDER, tag), join(out, tag), { recursive: true });
		}
	}
	return out;
}

/** One migration file, in one transaction: what D1 does, and what `defer_foreign_keys` needs. */
function run(db: DatabaseSync, tag: string) {
	const sql = readFileSync(join(MIGRATIONS_FOLDER, tag, 'migration.sql'), 'utf8');
	db.exec('BEGIN');
	try {
		for (const statement of sql.split('--> statement-breakpoint')) db.exec(statement);
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

const all = <T>(db: DatabaseSync, query: string) => db.prepare(query).all() as T[];

describe('sign-ups and hour logs name shifts', () => {
	let db: DatabaseSync;
	let shiftOf: (task: string) => string;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-shift-fk-')), 'd1.sqlite');
		applyMigrations(file, migrationsBeforePrepare());
		db = new DatabaseSync(file);
		db.exec('PRAGMA foreign_keys = ON');
		// `copied` got its shift in PR 1; `late` was made after PR 1 and has none yet;
		// `untimed` never had a time and was staffed by a staff-made sign-up.
		db.exec(`
			INSERT INTO "user" (id, name, email) VALUES
				('nia', 'Nia', 'nia@example.com'), ('sam', 'Sam', 'sam@example.com');
			INSERT INTO volunteer_role (id, name) VALUES ('door', 'Door');
			INSERT INTO work_order (id, volunteer_role_id, starts_at, ends_at, capacity) VALUES
				('copied', 'door', 1000, 5000, 2),
				('late', 'door', 9000, 12000, 1);
			INSERT INTO work_order (id, volunteer_role_id, title) VALUES ('untimed', 'door', 'Settlement');
			INSERT INTO volunteer_shift (id, work_order_id, starts_at, ends_at, capacity) VALUES
				('shift-copied', 'copied', 1000, 5000, 2);
			INSERT INTO volunteer_signup (id, shift_id, user_id, status, claimed_at, completed_at) VALUES
				('s-copied', 'copied', 'nia', 'completed', 900, 5100),
				('s-late', 'late', 'sam', 'claimed', 8000, NULL),
				('s-untimed', 'untimed', 'nia', 'completed', 700, 7000),
				('s-untimed-gone', 'untimed', 'sam', 'cancelled', 700, NULL);
			INSERT INTO volunteer_shift_feedback (id, signup_id, rating, was_set_up) VALUES
				('fb', 's-copied', 5, 1);
			INSERT INTO volunteer_hour_log (id, user_id, volunteer_role_id, shift_id, worked_on, minutes, description) VALUES
				('h-copied', 'nia', 'door', 'copied', 1000, 60, 'Door'),
				('h-untimed', 'nia', 'door', 'untimed', 1000, 90, 'Settlement'),
				('h-memory', 'sam', 'door', NULL, 1000, 30, 'From memory');
		`);
		run(db, PREPARE);
		run(db, REBUILD);
		const shifts = all<{ id: string; work_order_id: string }>(
			db,
			'SELECT id, work_order_id FROM volunteer_shift'
		);
		shiftOf = (task) => shifts.find((s) => s.work_order_id === task)!.id;
	});

	it('gives a work order made after PR 1 its shift, and leaves the copied one alone', () => {
		const counts = all<{ work_order_id: string; n: number }>(
			db,
			'SELECT work_order_id, count(*) AS n FROM volunteer_shift GROUP BY work_order_id ORDER BY 1'
		);
		expect(counts).toEqual([
			{ work_order_id: 'copied', n: 1 },
			{ work_order_id: 'late', n: 1 }
		]);
		expect(shiftOf('copied')).toBe('shift-copied');
	});

	it('maps each sign-up from its task to that task’s shift', () => {
		const signups = all<{ id: string; shift_id: string }>(
			db,
			'SELECT id, shift_id FROM volunteer_signup ORDER BY id'
		);
		expect(signups).toEqual([
			{ id: 's-copied', shift_id: shiftOf('copied') },
			{ id: 's-late', shift_id: shiftOf('late') }
		]);
	});

	it('keeps the feedback on a mapped sign-up', () => {
		expect(all(db, 'SELECT id, signup_id FROM volunteer_shift_feedback')).toEqual([
			{ id: 'fb', signup_id: 's-copied' }
		]);
	});

	it('turns a live staff-made sign-up on an untimed task into an assignee', () => {
		expect(
			all(db, 'SELECT work_order_id, user_id, assigned_at, completed_at FROM work_order_assignee')
		).toEqual([{ work_order_id: 'untimed', user_id: 'nia', assigned_at: 700, completed_at: 7000 }]);
	});

	it('moves an hour log naming an untimed task to its task link, and maps the rest', () => {
		expect(
			all(db, 'SELECT id, shift_id, work_order_id FROM volunteer_hour_log ORDER BY id')
		).toEqual([
			{ id: 'h-copied', shift_id: shiftOf('copied'), work_order_id: null },
			{ id: 'h-memory', shift_id: null, work_order_id: null },
			{ id: 'h-untimed', shift_id: null, work_order_id: 'untimed' }
		]);
	});

	it('leaves no foreign key violated', () => {
		expect(all(db, 'PRAGMA foreign_key_check')).toEqual([]);
	});

	it('points both columns at volunteer_shift', () => {
		const targets = (table: string) =>
			all<{ from: string; table: string }>(db, `PRAGMA foreign_key_list(${table})`)
				.filter((fk) => fk.from === 'shift_id')
				.map((fk) => fk.table);
		expect(targets('volunteer_signup')).toEqual(['volunteer_shift']);
		expect(targets('volunteer_hour_log')).toEqual(['volunteer_shift']);
	});
});
