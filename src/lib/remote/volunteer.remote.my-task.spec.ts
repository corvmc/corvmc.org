import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * A task's page (#2582, #2989), through the remotes, against a real SQLite.
 * Whoever `canActOnTask` admits reads it, ticks it, marks it done, takes it
 * and hands it back: the assignee, a seat on its committee, or a holder of
 * `volunteer.manageShifts`. A shift sign-up or another task's assignment is
 * not enough. Each is a join a mocked `db` would agree with either way.
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
		userHasCapability: async (_u: string, cap: string) =>
			manager && cap === 'volunteer.manageShifts',
		requireCapability: async () => {
			throw error(403, 'Not permitted');
		}
	};
});

const remote = (await import('./volunteer.remote')) as unknown as {
	getMyTask: (id: string) => PromiseLike<{ items: { id: string; done: boolean }[] }>;
	markMyTaskDone: (raw: { workOrderId: string; reason?: string }) => Promise<unknown>;
	takeTask: (raw: { workOrderId: string }) => Promise<unknown>;
	handBackTask: (raw: { workOrderId: string }) => Promise<unknown>;
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
		'group_member',
		'"group"',
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
		insert into "group" (id, kind, name, slug, join_policy) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only');
		insert into group_member (id, group_id, user_id, role, status) values
			('m-sam', 'booking', 'sam', 'member', 'active');
		insert into work_order (id, title, notes, group_id) values
			('wo-nia', 'Hang posters', 'Downtown first', null),
			('wo-sam', 'Book the van', null, null),
			('wo-booking', 'Confirm the headliner', null, 'booking');
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

	it('serves a capability holder, who may mark it done or take it', async () => {
		caller = 'staff';
		manager = true;
		await expect(remote.getMyTask('wo-nia')).resolves.toMatchObject({
			canMarkDone: true,
			canTake: true,
			canHandBack: false
		});
	});

	it('serves a seat on the owning committee, with no grant (#2983 case 1)', async () => {
		caller = 'sam';
		await expect(remote.getMyTask('wo-booking')).resolves.toMatchObject({
			canMarkDone: true,
			canTake: true
		});
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

const resolvedBy = (id: string) =>
	(
		sqlite.prepare(`select resolved_by_user_id as by from work_order where id = ?`).get(id) as {
			by: string | null;
		}
	).by;

describe('markMyTaskDone', () => {
	it('lets a committee seat close its committee’s task (#2983 case 1)', async () => {
		caller = 'sam';
		await remote.markMyTaskDone({ workOrderId: 'wo-booking' });
		expect(resolvedBy('wo-booking')).toBe('sam');
	});

	it('lets the assignee close a task with a done condition (#2983 case 4)', async () => {
		sqlite.exec(`update work_order set done_when = 'poster_set' where id = 'wo-nia'`);
		await remote.markMyTaskDone({ workOrderId: 'wo-nia', reason: 'Put up by hand' });
		expect(resolvedBy('wo-nia')).toBe('nia');
	});

	it('refuses a member with no seat, assignment or grant', async () => {
		await expect(remote.markMyTaskDone({ workOrderId: 'wo-booking' })).rejects.toMatchObject({
			status: 403
		});
		expect(resolvedBy('wo-booking')).toBeNull();
	});
});

describe('takeTask and handBackTask', () => {
	const holders = (id: string) =>
		(
			sqlite
				.prepare(`select user_id from work_order_assignee where work_order_id = ? order by user_id`)
				.all(id) as { user_id: string }[]
		).map((r) => r.user_id);

	it('lets a committee seat take its committee’s task and hand it back (#2983 cases 1, 4)', async () => {
		caller = 'sam';
		await remote.takeTask({ workOrderId: 'wo-booking' });
		expect(holders('wo-booking')).toEqual(['sam']);
		await expect(remote.getMyTask('wo-booking')).resolves.toMatchObject({ canHandBack: true });

		await remote.handBackTask({ workOrderId: 'wo-booking' });
		expect(holders('wo-booking')).toEqual([]);
	});

	it('lets an assignee hand back a task outside any committee', async () => {
		await remote.handBackTask({ workOrderId: 'wo-nia' });
		expect(holders('wo-nia')).toEqual([]);
	});

	it('refuses a member taking a task that is not theirs to act on', async () => {
		await expect(remote.takeTask({ workOrderId: 'wo-sam' })).rejects.toMatchObject({
			status: 403
		});
		expect(holders('wo-sam')).toEqual(['sam']);
	});
});
