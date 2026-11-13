import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The assignee's task page (#2582), through the remotes, against a real SQLite.
 * Only the task's `work_order_assignee`, or a holder of
 * `volunteer.manageShifts`, reads it or ticks its checklist; a shift sign-up
 * or another task's assignment is not enough. Each is a join a mocked `db`
 * would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

// A query call is a thenable with `refresh`, as kit's is; refreshing does nothing here.
vi.mock('$app/server', () => {
	// kit checks every export of a remote module carries this marker.
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	const call = (run: () => Promise<unknown>) => ({
		then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
		refresh: async () => {}
	});
	return {
		getRequestEvent: () => ({ locals: { user: { id: caller } }, url: new URL('http://x/') }),
		query: (...args: unknown[]) => {
			const handler = args.at(-1) as (raw: unknown) => Promise<unknown>;
			return mark((raw: unknown) => call(() => handler(raw)), 'query');
		},
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});

let caller = 'nia';
let manager = false;
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => ({ id: caller }),
		can: async (cap: string) => manager && cap === 'volunteer.manageShifts',
		requireCapability: async () => {
			throw error(403, 'Not permitted');
		}
	};
});

const remote = (await import('./volunteer.remote')) as unknown as {
	getMyTask: (id: string) => PromiseLike<{ items: { id: string; done: boolean }[] }>;
	setMyTaskItemDone: (raw: {
		workOrderId: string;
		itemId: string;
		done?: boolean;
	}) => Promise<unknown>;
};

const doneBy = (id: string) =>
	sqlite.prepare(`select done, done_by_user_id from work_task where id = ?`).get(id) as {
		done: number;
		done_by_user_id: string | null;
	};

beforeEach(() => {
	caller = 'nia';
	manager = false;
	for (const table of [
		'volunteer_signup',
		'volunteer_shift',
		'work_task',
		'work_order_assignee',
		'work_order',
		'"user"'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into "user" (id, name, email) values
			('nia', 'Nia', 'nia@example.com'),
			('sam', 'Sam', 'sam@example.com'),
			('staff', 'Staff', 'staff@example.com');
		insert into work_order (id, title, notes) values
			('wo-nia', 'Hang posters', 'Downtown first'),
			('wo-sam', 'Book the van', null);
		insert into work_order_assignee (work_order_id, user_id, assigned_at) values
			('wo-nia', 'nia', unixepoch()), ('wo-sam', 'sam', unixepoch());
		insert into work_task (id, work_order_id, label, sort_order) values
			('nia-1', 'wo-nia', 'Print them', 0),
			('nia-2', 'wo-nia', 'Hang them', 1),
			('sam-1', 'wo-sam', 'Call the hire place', 0);
	`);
});

describe('getMyTask', () => {
	it('serves the assignee the notes and checklist', async () => {
		await expect(remote.getMyTask('wo-nia')).resolves.toMatchObject({
			title: 'Hang posters',
			notes: 'Downtown first',
			canMarkDone: true,
			items: [
				{ id: 'nia-1', done: false },
				{ id: 'nia-2', done: false }
			]
		});
	});

	it('refuses somebody else, and a task that does not exist, alike', async () => {
		await expect(remote.getMyTask('wo-sam')).rejects.toMatchObject({ status: 403 });
		await expect(remote.getMyTask('wo-none')).rejects.toMatchObject({ status: 403 });
	});

	it('serves a capability holder, who cannot mark it done', async () => {
		caller = 'staff';
		manager = true;
		await expect(remote.getMyTask('wo-nia')).resolves.toMatchObject({ canMarkDone: false });
	});
});

describe('setMyTaskItemDone', () => {
	it('ticks and unticks an item for the assignee, attributed to them', async () => {
		await remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'nia-1', done: true });
		expect(doneBy('nia-1')).toEqual({ done: 1, done_by_user_id: 'nia' });

		await remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'nia-1' });
		expect(doneBy('nia-1')).toEqual({ done: 0, done_by_user_id: null });
	});

	it('refuses a member who is not assigned the task', async () => {
		caller = 'sam';
		await expect(
			remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'nia-1', done: true })
		).rejects.toMatchObject({ status: 403 });
		expect(doneBy('nia-1').done).toBe(0);
	});

	it('refuses a member signed up for one of its shifts but not assigned it', async () => {
		caller = 'sam';
		sqlite.exec(`
			insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
				values ('sh-1', 'wo-nia', unixepoch(), unixepoch() + 3600, 2);
			insert into volunteer_signup (id, shift_id, user_id, status)
				values ('su-1', 'sh-1', 'sam', 'confirmed');
		`);
		await expect(
			remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'nia-1', done: true })
		).rejects.toMatchObject({ status: 403 });
	});

	it("refuses another task's item named under the caller's own task", async () => {
		await expect(
			remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'sam-1', done: true })
		).rejects.toMatchObject({ status: 404 });
		expect(doneBy('sam-1').done).toBe(0);
	});

	it('refuses an item on a called-off task', async () => {
		sqlite.exec(`update work_order set cancelled_at = unixepoch() where id = 'wo-nia'`);
		await expect(
			remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'nia-1', done: true })
		).rejects.toMatchObject({ status: 404 });
	});

	it('lets a capability holder tick it, attributed to them', async () => {
		caller = 'staff';
		manager = true;
		await remote.setMyTaskItemDone({ workOrderId: 'wo-nia', itemId: 'nia-2', done: true });
		expect(doneBy('nia-2')).toEqual({ done: 1, done_by_user_id: 'staff' });
	});
});
