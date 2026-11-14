import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A member's assigned tasks (#2518), against a real SQLite: the list holds open
 * tasks, then done ones until an hour log names them, and only an assignee
 * marks one done. Each is a `WHERE` a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
const emit = vi.spyOn(domainEvents, 'emit');
const svc = await import('./work-order-service');
const { assignToTask, listAssignedTasksForUser, markAssignedTaskDone, NotAssignedToTaskError } =
	await import('./assignee-service');
const { submitHours } = await import('./hour-log-service');

const one = <T>(query: string) => sqlite.prepare(query).get() as T;

beforeEach(() => {
	for (const table of [
		'volunteer_hour_log',
		'work_task',
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

async function assignedTask(userId = 'nia') {
	const task = await svc.createWorkOrder({ volunteerRoleId: 'stage', createdByUserId: 'staff' });
	await assignToTask(task, userId, 'staff');
	return task;
}

describe('assignToTask announces the assignment (#2986)', () => {
	const announced = () => emit.mock.calls.filter(([event]) => event === 'volunteer.task_assigned');

	beforeEach(() => {
		emit.mockClear();
	});

	it('tells the assignee when somebody else assigns them', async () => {
		const task = await svc.createWorkOrder({
			volunteerRoleId: 'stage',
			title: 'Fix the PA',
			createdByUserId: 'staff'
		});
		await assignToTask(task, 'nia', 'staff');

		expect(announced()).toEqual([
			[
				'volunteer.task_assigned',
				expect.objectContaining({
					workOrderId: task.id,
					title: 'Fix the PA',
					recipient: { userId: 'nia', userName: 'Nia', userEmail: 'nia@example.com' },
					assignedByName: 'Staff'
				})
			]
		]);
	});

	it('names the role for a task with no title', async () => {
		await assignedTask();
		expect(announced()[0][1]).toMatchObject({ title: 'Stage crew' });
	});

	it('sends nothing to a member who takes a task, or for a repeat assignment', async () => {
		const task = await svc.createWorkOrder({ volunteerRoleId: 'stage', createdByUserId: 'staff' });
		await assignToTask(task, 'nia', 'nia');
		await assignToTask(task, 'sam', 'staff');
		await assignToTask(task, 'sam', 'staff');

		expect(
			announced().map(([, e]) => (e as { recipient: { userId: string } }).recipient.userId)
		).toEqual(['sam']);
	});
});

describe('listAssignedTasksForUser', () => {
	it('lists an open task for its assignee and nobody else', async () => {
		const task = await assignedTask();
		sqlite.exec(`
			insert into work_task (id, work_order_id, label, done, done_at) values
				('a', '${task.id}', 'Book the van', 1, unixepoch()), ('b', '${task.id}', 'Load out', 0, null);
		`);

		const [row] = await listAssignedTasksForUser('nia');
		expect(row).toMatchObject({
			workOrderId: task.id,
			roleName: 'Stage crew',
			resolvedAt: null,
			closesItself: false,
			checklist: { done: 1, total: 2 }
		});
		expect(await listAssignedTasksForUser('sam')).toEqual([]);
	});

	it('keeps a done task until an hour log names it', async () => {
		const task = await assignedTask();
		await svc.resolveWorkOrder(task.id, { resolvedByUserId: 'staff' });

		const [done] = await listAssignedTasksForUser('nia');
		expect(done.workOrderId).toBe(task.id);
		expect(done.completedAt).toBeInstanceOf(Date);

		const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(
			new Date()
		);
		await submitHours('nia', {
			volunteerRoleId: 'stage',
			workedOn: today,
			minutes: 90,
			description: 'Ran the stage',
			workOrderId: task.id
		});
		expect(await listAssignedTasksForUser('nia')).toEqual([]);
	});

	it('drops a cancelled task', async () => {
		const task = await assignedTask();
		sqlite.exec(`update work_order set cancelled_at = unixepoch() where id = '${task.id}'`);
		expect(await listAssignedTasksForUser('nia')).toEqual([]);
	});
});

describe('markAssignedTaskDone', () => {
	it('closes the task and stamps every assignee', async () => {
		const task = await assignedTask();
		await assignToTask(task, 'sam', 'staff');

		await markAssignedTaskDone(task.id, 'nia');

		expect(
			one<{ resolved_by_user_id: string }>(
				`select resolved_by_user_id from work_order where id = '${task.id}'`
			).resolved_by_user_id
		).toBe('nia');
		expect(
			one<{ n: number }>(
				`select count(*) as n from work_order_assignee where work_order_id = '${task.id}' and completed_at is not null`
			).n
		).toBe(2);
	});

	it('refuses somebody the task is not assigned to', async () => {
		const task = await assignedTask('sam');
		await expect(markAssignedTaskDone(task.id, 'nia')).rejects.toBeInstanceOf(
			NotAssignedToTaskError
		);
	});

	it('refuses a task with a done condition, which closes itself', async () => {
		const task = await assignedTask();
		sqlite.exec(`update work_order set done_when = 'poster_set' where id = '${task.id}'`);
		await expect(markAssignedTaskDone(task.id, 'nia')).rejects.toBeInstanceOf(
			svc.ShiftValidationError
		);
		expect((await listAssignedTasksForUser('nia'))[0].closesItself).toBe(true);
	});
});

describe('assignment writes', () => {
	// The notice is sent from `assignToTask`, so a second write path would assign silently.
	it('go through assignToTask alone', async () => {
		const { globSync, readFileSync } = await import('node:fs');
		const writers = globSync('src/**/*.ts')
			.filter((f) => !f.endsWith('.spec.ts'))
			.filter((f) => /insert\(\s*workOrderAssignee\b/.test(readFileSync(f, 'utf8')));
		expect(writers).toEqual(['src/lib/server/volunteer/assignee-service.ts']);
	});
});
