import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task dependencies (#2625), against a real SQLite: a cycle is refused on
 * write however long the loop, Blocked is read from open blockers, closing a
 * blocked task records it, and the last blocker closing tells the assignees.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const deps = await import('./task-dependencies');
const svc = await import('./work-order-service');
const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');

const all = <T>(query: string) => sqlite.prepare(query).all() as T[];
const emit = vi.spyOn(domainEvents, 'emit');

beforeEach(() => {
	emit.mockClear();
	for (const table of [
		'audit_log',
		'work_order_dependency',
		'work_order_assignee',
		'volunteer_shift',
		'work_order',
		'project',
		'"user"'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into "user" (id, name, email) values
			('staff', 'Staff', 'staff@example.com'), ('nia', 'Nia', 'nia@example.com');
		insert into project (id, name) values ('p1', 'Grant'), ('p2', 'Other');
		insert into work_order (id, title, project_id) values
			('narrative', 'Narrative', 'p1'), ('budget', 'Budget', 'p1'),
			('submit', 'Submit', 'p1'), ('elsewhere', 'Elsewhere', 'p2');
	`);
});

const add = (workOrderId: string, dependsOnId: string) =>
	deps.addDependency({ workOrderId, dependsOnId, byUserId: 'staff' });

describe('adding a dependency', () => {
	it('records the edge once, and audits it once', async () => {
		await add('budget', 'narrative');
		await add('budget', 'narrative');
		expect(all(`select work_order_id, depends_on_id from work_order_dependency`)).toEqual([
			{ work_order_id: 'budget', depends_on_id: 'narrative' }
		]);
		expect(all(`select action from audit_log`)).toEqual([
			{ action: 'work_order.dependency_added' }
		]);
	});

	it('refuses a loop, direct or through other tasks, and writes nothing', async () => {
		await add('budget', 'narrative');
		await add('submit', 'budget');
		await expect(add('narrative', 'budget')).rejects.toBeInstanceOf(deps.TaskDependencyError);
		await expect(add('narrative', 'submit')).rejects.toBeInstanceOf(deps.TaskDependencyError);
		await expect(add('submit', 'submit')).rejects.toBeInstanceOf(deps.TaskDependencyError);
		expect(all(`select 1 from work_order_dependency`)).toHaveLength(2);
	});

	it('is a graph: one task waits on several, and several on one', async () => {
		await add('submit', 'narrative');
		await add('submit', 'budget');
		await add('budget', 'narrative');
		expect(
			(await deps.listTaskDependencies('narrative')).neededFor.map((t) => t.id).sort()
		).toEqual(['budget', 'submit']);
	});

	it('stays within one project', async () => {
		await expect(add('budget', 'elsewhere')).rejects.toBeInstanceOf(deps.TaskDependencyError);
		expect((await deps.listDependencyOptions('budget')).map((t) => t.id).sort()).toEqual([
			'narrative',
			'submit'
		]);
	});

	it('refuses a self edge in the database too', () => {
		expect(() =>
			sqlite.exec(
				`insert into work_order_dependency (work_order_id, depends_on_id) values ('budget', 'budget')`
			)
		).toThrow(/CHECK/);
	});
});

describe('Blocked', () => {
	it('counts only open blockers, and a called-off one blocks nothing', async () => {
		await add('submit', 'narrative');
		await add('submit', 'budget');
		expect(await deps.countOpenBlockers('submit')).toBe(2);
		await svc.cancelShift('budget', 'staff');
		expect(await deps.countOpenBlockers('submit')).toBe(1);
		expect((await deps.listOpenBlockers()).submit.map((b) => b.label)).toEqual(['Narrative']);
	});
});

describe('closing tasks', () => {
	it('records a blocked task marked done, and allows it', async () => {
		await add('submit', 'narrative');
		await svc.resolveWorkOrder('submit', { resolvedByUserId: 'staff' });
		expect(
			all<{ details: string }>(
				`select details from audit_log where action = 'work_order.resolved' and subject_id = 'submit'`
			).map((r) => JSON.parse(r.details))
		).toEqual([expect.objectContaining({ openBlockers: 1 })]);
	});

	it('tells the assignees once the last blocker is closed, and not before', async () => {
		sqlite.exec(
			`insert into work_order_assignee (work_order_id, user_id) values ('submit', 'nia')`
		);
		await add('submit', 'narrative');
		await add('submit', 'budget');
		const ready = () => emit.mock.calls.filter(([event]) => event === 'volunteer.task_ready');

		await svc.resolveWorkOrder('narrative', { resolvedByUserId: 'staff' });
		expect(ready()).toHaveLength(0);

		await svc.resolveWorkOrder('budget', { resolvedByUserId: 'staff' });
		expect(ready()).toHaveLength(1);
		expect(ready()[0][1]).toMatchObject({
			workOrderId: 'submit',
			closedTitle: 'Budget',
			recipient: { userId: 'nia' }
		});
	});

	it('removes edges with either task', async () => {
		await add('submit', 'narrative');
		// D1 enforces foreign keys; this file's SQLite does only when asked.
		sqlite.pragma('foreign_keys = ON');
		sqlite.exec(`delete from work_order where id = 'narrative'`);
		sqlite.pragma('foreign_keys = OFF');
		expect(all(`select 1 from work_order_dependency`)).toHaveLength(0);
	});
});
