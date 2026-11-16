import { describe, it, expect, vi, beforeEach } from 'vitest';

/** One open task per record (#2756), stated by `uq_work_order_open_source`. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: async (key: string) => (key === 'inventory.restockRoleId' ? 'retired' : '')
}));

const { openSourcedTask, closeSourcedTasks, openSourceIds } = await import('./sourced-tasks');

const input = { source: 'restock' as const, sourceId: 'item-1', title: 'Restock picks' };

beforeEach(() => {
	sqlite.exec(`
		delete from work_order_assignee; delete from work_order; delete from volunteer_role;
		delete from "user";
		insert into "user" (id, name, email) values ('u', 'U', 'u@example.com');
		insert into volunteer_role (id, name, is_active) values ('retired', 'Old', 0);
	`);
});

describe('sourced tasks', () => {
	it('callers racing get one task', async () => {
		const results = await Promise.all([openSourcedTask(input), openSourcedTask(input)]);
		expect(new Set(results.map((r) => r.id)).size).toBe(1);
		expect(sqlite.prepare(`select count(*) n from work_order`).get()).toEqual({ n: 1 });
	});

	it('the database refuses a second open task for one record', () => {
		sqlite.exec(
			`insert into work_order (id, title, source, source_id) values ('a', 'A', 'restock', 'x')`
		);
		expect(() =>
			sqlite.exec(
				`insert into work_order (id, title, source, source_id) values ('b', 'B', 'restock', 'x')`
			)
		).toThrow(/UNIQUE/);
	});

	it('an inactive role setting leaves the task with no role', async () => {
		const { id } = await openSourcedTask(input);
		expect(sqlite.prepare(`select volunteer_role_id from work_order where id = ?`).get(id)).toEqual(
			{
				volunteer_role_id: null
			}
		);
	});

	it('closing stamps assignees done and frees the record for a new task', async () => {
		const { id } = await openSourcedTask(input);
		sqlite.exec(`insert into work_order_assignee (work_order_id, user_id) values ('${id}', 'u')`);
		expect(await closeSourcedTasks('restock', ['item-1'], 'Closed: done.')).toBe(1);
		expect(
			sqlite.prepare(`select completed_at is not null done from work_order_assignee`).get()
		).toEqual({ done: 1 });
		expect((await openSourceIds('restock')).size).toBe(0);
		expect((await openSourcedTask(input)).opened).toBe(true);
	});
});
