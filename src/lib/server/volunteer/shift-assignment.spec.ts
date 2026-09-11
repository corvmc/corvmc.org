/**
 * Authorisation by assignment, against a real database on the real schema.
 *
 * The whole question is a join — does a signup connect this member to the work
 * order this task hangs off — so a mock would be asserting on the mock. The
 * negatives matter more than the positive here: a cancelled signup and a
 * called-off shift both have to stop reading as an assignment.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

const sqlite = new DatabaseSync(':memory:');
const base = drizzle({ client: sqlite });

vi.mock('$lib/server/db', () => ({
	db: new Proxy({}, { get: (_, prop) => Reflect.get(base as object, prop, base) }),
	getRowCount: () => 0
}));

const STARTS = Math.floor(new Date('2026-10-10T03:00:00Z').getTime() / 1000);
const ENDS = Math.floor(new Date('2026-10-10T07:00:00Z').getTime() / 1000);

let setWorkTaskDoneAsAssignee: typeof import('./duty-list-service').setWorkTaskDoneAsAssignee;
let NotAssignedToShiftError: typeof import('./duty-list-service').NotAssignedToShiftError;
let getSignupForUser: typeof import('./volunteer-signup-service').getSignupForUser;

beforeAll(async () => {
	migrate(base, { migrationsFolder: MIGRATIONS_FOLDER });
	({ setWorkTaskDoneAsAssignee, NotAssignedToShiftError } = await import('./duty-list-service'));
	({ getSignupForUser } = await import('./volunteer-signup-service'));
}, 30_000);

/** Two members, one shift on a show, one task, one signup — the crew and a bystander. */
beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'work_task',
		'work_order',
		'event_listing',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}

	sqlite.exec(`
		INSERT INTO user (id, name, email, email_verified) VALUES
			('u-crew',  'Crew',      'crew@example.com',  1),
			('u-other', 'Bystander', 'other@example.com', 1);

		INSERT INTO volunteer_role (id, name) VALUES ('role-1', 'Setup');

		INSERT INTO event_listing (id, title, starts_at, ends_at, created_by_user_id)
		 VALUES ('evt-1', 'Show', ${STARTS}, ${ENDS}, 'u-crew');

		INSERT INTO work_order (id, volunteer_role_id, event_id, starts_at, ends_at)
		 VALUES ('wo-1', 'role-1', 'evt-1', ${STARTS}, ${ENDS});

		INSERT INTO work_task (id, work_order_id, label) VALUES ('task-1', 'wo-1', 'Sweep the stage');

		INSERT INTO volunteer_signup (id, shift_id, user_id, status)
		 VALUES ('signup-1', 'wo-1', 'u-crew', 'confirmed');
	`);
});

const task = () =>
	sqlite.prepare(`SELECT done, done_by_user_id FROM work_task WHERE id = 'task-1'`).get() as {
		done: number;
		done_by_user_id: string | null;
	};

describe('setWorkTaskDoneAsAssignee', () => {
	it('lets the volunteer on the shift tick their own task', async () => {
		await setWorkTaskDoneAsAssignee('task-1', true, 'u-crew');

		expect(task().done).toBe(1);
		// Attribution, not credit: hours belong to the work order.
		expect(task().done_by_user_id).toBe('u-crew');
	});

	it('refuses a member who is not on the shift', async () => {
		await expect(setWorkTaskDoneAsAssignee('task-1', true, 'u-other')).rejects.toThrow(
			NotAssignedToShiftError
		);
		expect(task().done).toBe(0);
	});

	it('refuses once the volunteer has dropped out', async () => {
		sqlite.exec(
			`UPDATE volunteer_signup SET status = 'cancelled', cancelled_at = unixepoch() WHERE id = 'signup-1'`
		);

		await expect(setWorkTaskDoneAsAssignee('task-1', true, 'u-crew')).rejects.toThrow(
			NotAssignedToShiftError
		);
	});

	it('refuses once the shift itself is called off', async () => {
		sqlite.exec(`UPDATE work_order SET cancelled_at = unixepoch() WHERE id = 'wo-1'`);

		await expect(setWorkTaskDoneAsAssignee('task-1', true, 'u-crew')).rejects.toThrow(
			NotAssignedToShiftError
		);
	});

	it('unticks as readily as it ticks, and clears the attribution', async () => {
		await setWorkTaskDoneAsAssignee('task-1', true, 'u-crew');
		await setWorkTaskDoneAsAssignee('task-1', false, 'u-crew');

		expect(task().done).toBe(0);
		expect(task().done_by_user_id).toBeNull();
	});
});

describe('getSignupForUser', () => {
	it('reads the shift, the show it staffs, and who called it off', async () => {
		const row = await getSignupForUser('signup-1', 'u-crew');

		expect(row).toMatchObject({
			shiftId: 'wo-1',
			roleName: 'Setup',
			eventId: 'evt-1',
			eventTitle: 'Show',
			status: 'confirmed'
		});
	});

	it('answers null for somebody else’s signup rather than the row', async () => {
		// The scope is the pair, not the id: a guessed signup id reaches nothing.
		await expect(getSignupForUser('signup-1', 'u-other')).resolves.toBeNull();
	});
});
