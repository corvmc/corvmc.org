import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * Tasks and shifts as two tables (#2518), against a real SQLite: a task is the
 * work, a shift is a time volunteers sign up for. The predicates here — which
 * tasks wait for a shift, which shifts are on the board, which tasks have run
 * out of shifts — only mean anything with the real joins.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const svc = await import('./work-order-service');
const signups = await import('./volunteer-signup-service');
const { listTasksWithEndedShifts } = await import('./ended-shifts');
const { placePendingWorkOrders, shiftAnchoredWorkOrders } = await import('./retime-work-orders');
const { db } = await import('#lib/server/db/index.js');

const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);
const one = <T>(query: string) => sqlite.prepare(query).get() as T;
const all = <T>(query: string) => sqlite.prepare(query).all() as T[];

/** `YYYY-MM-DDTHH:mm` in club time, days from now, for the shift form. */
function local(daysAhead: number, hour: number) {
	const d = new Date(Date.now() + daysAhead * 86_400_000);
	const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
	return `${ymd}T${String(hour).padStart(2, '0')}:00`;
}

beforeEach(() => {
	for (const table of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order_assignee',
		'work_order',
		'volunteer_profile',
		'volunteer_role',
		'"user"'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into "user" (id, name, email) values
			('staff', 'Staff', 'staff@example.com'),
			('nia', 'Nia', 'nia@example.com'),
			('sam', 'Sam', 'sam@example.com');
		insert into volunteer_profile (user_id, first_name, last_name, is_adult, status) values
			('nia', 'Nia', 'O', 1, 'active'), ('sam', 'Sam', 'S', 1, 'active');
		insert into volunteer_role (id, name) values ('door', 'Door');
	`);
});

describe('a new shift', () => {
	it('is a task and one shift, and the board lists the shift by its own id', async () => {
		const task = await svc.createShift({
			volunteerRoleId: 'door',
			title: 'Saturday door',
			startsAt: local(2, 18),
			endsAt: local(2, 22),
			capacity: 2,
			createdByUserId: 'staff'
		});
		expect(
			one(`select count(*) n from volunteer_shift where work_order_id = '${task.id}'`)
		).toEqual({ n: 1 });

		const board = await svc.listOpenShiftsForMember('nia');
		expect(
			board.map((s) => ({ id: s.id, workOrderId: s.workOrderId, capacity: s.capacity }))
		).toEqual([{ id: task.shiftId, workOrderId: task.id, capacity: 2 }]);

		const [row] = await svc.listShifts();
		expect({ id: row.id, shiftId: row.shiftId }).toEqual({ id: task.id, shiftId: task.shiftId });
	});
});

describe('signing up', () => {
	async function openShift(capacity = 1) {
		const task = await svc.createWorkOrder({ volunteerRoleId: 'door', createdByUserId: 'staff' });
		const shift = await svc.openShift(task.id, {
			startsAt: local(2, 18),
			endsAt: local(2, 22),
			capacity,
			createdByUserId: 'staff'
		});
		return { task, shift };
	}

	it('names the shift, and refuses a place the shift does not have', async () => {
		const { shift } = await openShift(1);
		const signup = await signups.claimShift(shift.id, 'nia');
		expect(signup.shiftId).toBe(shift.id);
		await expect(signups.claimShift(shift.id, 'sam')).rejects.toBeInstanceOf(
			signups.ShiftFullError
		);
	});

	it('is refused on a task already marked done', async () => {
		const { task, shift } = await openShift(2);
		await svc.resolveWorkOrder(task.id, { resolvedByUserId: 'staff' });
		await expect(signups.claimShift(shift.id, 'nia')).rejects.toBeInstanceOf(
			signups.ShiftClosedError
		);
	});
});

describe('the coordinator queues', () => {
	it('lists a task with no live shift as waiting for one, and drops it once one is open', async () => {
		const task = await svc.createWorkOrder({ volunteerRoleId: 'door', createdByUserId: 'staff' });
		expect((await svc.listWorkOrders()).map((w) => w.id)).toEqual([task.id]);

		await svc.openShift(task.id, {
			startsAt: local(1, 18),
			endsAt: local(1, 20),
			createdByUserId: 'staff'
		});
		expect(await svc.listWorkOrders()).toEqual([]);
	});

	it('lists an open task whose last shift has ended, until it is marked done', async () => {
		sqlite.exec(`
			insert into work_order (id, volunteer_role_id, title) values
				('ended', 'door', 'Ended'), ('ahead', 'door', 'Ahead'), ('done', 'door', 'Done');
			update work_order set resolved_at = ${now()} where id = 'done';
			insert into volunteer_shift (id, work_order_id, starts_at, ends_at) values
				('s1', 'ended', ${now() - 5 * HOUR}, ${now() - 3 * HOUR}),
				('s2', 'ahead', ${now() - 5 * HOUR}, ${now() - 3 * HOUR}),
				('s3', 'ahead', ${now() + 3 * HOUR}, ${now() + 5 * HOUR}),
				('s4', 'done', ${now() - 5 * HOUR}, ${now() - 3 * HOUR});
		`);
		expect((await listTasksWithEndedShifts()).map((t) => t.id)).toEqual(['ended']);
		expect(await signups.countVolunteerWorkWaiting()).toBe(1);
	});
});

describe('the clock', () => {
	it('completes sign-ups on a shift that has ended, and leaves its task open', async () => {
		sqlite.exec(`
			insert into work_order (id, volunteer_role_id) values ('t', 'door');
			insert into volunteer_shift (id, work_order_id, starts_at, ends_at) values
				('s', 't', ${now() - 4 * HOUR}, ${now() - HOUR});
			insert into volunteer_signup (id, shift_id, user_id, status) values ('su', 's', 'nia', 'confirmed');
		`);
		const done = await signups.completeFinishedShifts();
		expect(done.map((d) => ({ signupId: d.signupId, workOrderId: d.workOrderId }))).toEqual([
			{ signupId: 'su', workOrderId: 't' }
		]);
		expect(one(`select resolved_at from work_order where id = 't'`)).toEqual({ resolved_at: null });
	});
});

describe('calling off a task', () => {
	it('calls off its live shifts with it', async () => {
		const task = await svc.createShift({
			volunteerRoleId: 'door',
			startsAt: local(3, 18),
			endsAt: local(3, 20),
			capacity: 1,
			createdByUserId: 'staff'
		});
		await svc.cancelShift(task.id, 'staff');
		expect(
			one(`select cancelled_at is not null c from volunteer_shift where id = '${task.shiftId}'`)
		).toEqual({ c: 1 });
	});
});

describe('marking a task done', () => {
	it('stamps every assignee', async () => {
		sqlite.exec(`
			insert into work_order (id, title) values ('t', 'Settlement');
			insert into work_order_assignee (work_order_id, user_id) values ('t', 'nia');
		`);
		await svc.resolveWorkOrder('t', { resolvedByUserId: 'staff' });
		expect(one(`select completed_at is not null c from work_order_assignee`)).toEqual({ c: 1 });
	});
});

describe('duty-list timing', () => {
	it('places a pending window as a shift with its places, and a pending deadline on the task', async () => {
		sqlite.exec(`
			insert into work_order (id, volunteer_role_id, event_id, anchor, pending_offset_minutes,
				pending_duration_minutes, pending_capacity) values
				('window', 'door', 'ev', 'end', -60, 120, 3);
			insert into work_order (id, volunteer_role_id, event_id, anchor, pending_offset_minutes) values
				('deadline', 'door', 'ev', 'end', 30);
		`);
		const at = now() + 10 * HOUR;
		await db.batch(placePendingWorkOrders({ eventId: 'ev' }, ['end'], sql`${at}`));

		expect(
			all(`select work_order_id, starts_at, ends_at, capacity, anchor from volunteer_shift`)
		).toEqual([
			{
				work_order_id: 'window',
				starts_at: at - 60 * 60,
				ends_at: at + 60 * 60,
				capacity: 3,
				anchor: 'end'
			}
		]);
		expect(
			all(
				`select id, due_at, pending_offset_minutes from work_order where id in ('window', 'deadline') order by id`
			)
		).toEqual([
			{ id: 'deadline', due_at: at + 30 * 60, pending_offset_minutes: null },
			{ id: 'window', due_at: null, pending_offset_minutes: null }
		]);

		await db.batch(shiftAnchoredWorkOrders('ev', ['end'], sql`${HOUR}`));
		expect(one(`select starts_at from volunteer_shift`)).toEqual({ starts_at: at });
		expect(one(`select due_at from work_order where id = 'deadline'`)).toEqual({
			due_at: at + 30 * 60 + HOUR
		});
	});
});

describe('assignment mode', () => {
	it('reads open from a live shift and members from assignees', async () => {
		sqlite.exec(`
			insert into work_order (id, volunteer_role_id) values ('open', 'door'), ('members', 'door'), ('none', 'door');
			insert into volunteer_shift (id, work_order_id, starts_at, ends_at) values
				('s', 'open', ${now() + HOUR}, ${now() + 2 * HOUR});
			insert into work_order_assignee (work_order_id, user_id) values ('members', 'nia');
		`);
		const modes = await svc.workOrderModes(['open', 'members', 'none']);
		expect(Object.fromEntries(modes)).toEqual({
			open: 'open',
			members: 'members',
			none: 'unassigned'
		});
	});
});
