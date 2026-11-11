import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A task with several shifts (#2518, PR 3), against a real SQLite: each shift
 * is edited, copied and called off on its own, and calling one off leaves the
 * task and its other shifts alone. Delegating to a contractor takes everybody
 * off, from whichever page it is done.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
// Released sign-ups tell each person; nothing here is about the message.
vi.mock('#lib/server/event-bus/index.js', () => ({ emit: vi.fn(), on: vi.fn() }));

const svc = await import('./work-order-service');
const { loadWorkOrderView } = await import('./work-order-view');
const { assignToTask } = await import('./assignee-service');
const { engageContractorOnTask } = await import('./task-people');
const { countVolunteerWorkWaiting } = await import('./volunteer-signup-service');
const { db } = await import('#lib/server/db/index.js');
const { workOrder } = await import('#lib/server/db/schema/volunteer.js');

const one = <T>(query: string) => sqlite.prepare(query).get() as T;
const all = <T>(query: string) => sqlite.prepare(query).all() as T[];

/** `YYYY-MM-DDTHH:mm` in club time, days from now, as the shift form posts it. */
function local(daysAhead: number, hour: number) {
	const d = new Date(Date.now() + daysAhead * 86_400_000);
	const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
	return `${ymd}T${String(hour).padStart(2, '0')}:00`;
}

beforeEach(() => {
	for (const table of [
		'contractor_job',
		'contractor',
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
		insert into volunteer_role (id, name) values ('stage', 'Stage crew');
	`);
});

/** A task with two shifts, two and three days out. */
async function taskWithTwoShifts() {
	const task = await svc.createWorkOrder({ volunteerRoleId: 'stage', createdByUserId: 'staff' });
	const first = await svc.openShift(task.id, {
		startsAt: local(2, 10),
		endsAt: local(2, 14),
		capacity: 2,
		createdByUserId: 'staff'
	});
	const second = await svc.openShift(task.id, {
		startsAt: local(3, 10),
		endsAt: local(3, 14),
		capacity: 3,
		createdByUserId: 'staff'
	});
	return { task, first, second };
}

describe("a task's page", () => {
	it('lists every shift with its own roster', async () => {
		const { task, first, second } = await taskWithTwoShifts();
		sqlite.exec(`
			insert into volunteer_signup (id, shift_id, user_id, status) values
				('s1', '${first.id}', 'nia', 'confirmed'),
				('s2', '${second.id}', 'sam', 'claimed');
		`);

		const view = await loadWorkOrderView(task.id);
		expect(
			view?.shifts.map((s) => ({
				id: s.id,
				capacity: s.capacity,
				claimed: s.claimed,
				people: s.claimants.map((c) => c.signupId)
			}))
		).toEqual([
			{ id: first.id, capacity: 2, claimed: 1, people: ['s1'] },
			{ id: second.id, capacity: 3, claimed: 1, people: ['s2'] }
		]);
	});
});

describe('calling off one shift', () => {
	it('leaves the task and its other shifts live', async () => {
		const { task, first, second } = await taskWithTwoShifts();

		await svc.cancelOneShift(first.id, 'staff');

		expect(all(`select id from volunteer_shift where cancelled_at is null`)).toEqual([
			{ id: second.id }
		]);
		expect(one(`select cancelled_at from work_order where id = '${task.id}'`)).toEqual({
			cancelled_at: null
		});
		await expect(svc.cancelOneShift(first.id, 'staff')).rejects.toBeInstanceOf(
			svc.ShiftValidationError
		);
	});
});

describe('editing one shift', () => {
	it('moves only that shift, and refuses fewer places than are taken', async () => {
		const { first, second } = await taskWithTwoShifts();
		sqlite.exec(`
			insert into volunteer_signup (id, shift_id, user_id, status) values
				('s1', '${first.id}', 'nia', 'confirmed'), ('s2', '${first.id}', 'sam', 'claimed');
		`);

		await svc.editShift(first.id, { startsAt: local(4, 9), endsAt: local(4, 12), capacity: 4 });
		expect(one(`select capacity from volunteer_shift where id = '${first.id}'`)).toEqual({
			capacity: 4
		});
		expect(one(`select capacity from volunteer_shift where id = '${second.id}'`)).toEqual({
			capacity: 3
		});
		await expect(svc.editShift(first.id, { capacity: 1 })).rejects.toBeInstanceOf(
			svc.ShiftValidationError
		);
	});
});

describe('copying a shift forward', () => {
	it('adds a shift to the same task, with nobody on it', async () => {
		const { task, first } = await taskWithTwoShifts();
		sqlite.exec(
			`insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', '${first.id}', 'nia', 'confirmed')`
		);

		const copy = await svc.copyShiftForward(first.id, 7, 'staff');

		expect(copy.workOrderId).toBe(task.id);
		expect(copy.capacity).toBe(2);
		expect(all(`select 1 from work_order`)).toHaveLength(1);
		expect(all(`select 1 from volunteer_signup where shift_id = '${copy.id}'`)).toHaveLength(0);
	});
});

describe('editing the task', () => {
	it('changes its own name and notes, and no shift', async () => {
		const { task, first } = await taskWithTwoShifts();
		const before = one(`select starts_at, notes from volunteer_shift where id = '${first.id}'`);

		await svc.editTask(task.id, { title: 'Festival stage', notes: 'Bring gloves' });

		expect(one(`select title, notes from work_order where id = '${task.id}'`)).toEqual({
			title: 'Festival stage',
			notes: 'Bring gloves'
		});
		expect(one(`select starts_at, notes from volunteer_shift where id = '${first.id}'`)).toEqual(
			before
		);
	});
});

describe('unassigned tasks', () => {
	it('counts a task with no shift and nobody assigned, and stops once someone is', async () => {
		const task = await svc.createWorkOrder({ volunteerRoleId: 'stage', createdByUserId: 'staff' });
		const waiting = () => db.$count(workOrder, svc.unassignedTaskWhere());

		expect(await waiting()).toBe(1);
		const badge = await countVolunteerWorkWaiting();

		await assignToTask(task, 'nia', 'staff');

		expect(await waiting()).toBe(0);
		expect(await countVolunteerWorkWaiting()).toBe(badge - 1);
		// Still on the coordinator's queue: it has no time yet.
		expect((await svc.listWorkOrders()).map((w) => [w.id, w.assignees])).toEqual([[task.id, 1]]);
	});
});

describe('engaging a contractor on a task', () => {
	it('warns with people on it, then takes them off and calls off its shifts', async () => {
		const { task, first } = await taskWithTwoShifts();
		sqlite.exec(`
			insert into contractor (id, name, trade) values ('c1', 'Sparky', 'electrical');
			insert into volunteer_signup (id, shift_id, user_id, status) values
				('s1', '${first.id}', 'sam', 'confirmed');
		`);
		await assignToTask(task, 'nia', 'staff');
		const input = { contractorId: 'c1', workOrderId: task.id, requestedByUserId: 'staff' };

		expect(await engageContractorOnTask(input, false)).toEqual({
			status: 'needs_confirmation',
			people: 2
		});
		expect(all(`select 1 from contractor_job`)).toHaveLength(0);

		const done = await engageContractorOnTask(input, true);

		expect(done.status).toBe('done');
		expect(all(`select 1 from work_order_assignee`)).toHaveLength(0);
		expect(all(`select 1 from volunteer_shift where cancelled_at is null`)).toHaveLength(0);
		expect(one(`select status from volunteer_signup where id = 's1'`)).toEqual({
			status: 'cancelled'
		});
	});
});
