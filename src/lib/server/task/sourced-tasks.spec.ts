import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskSources } from '#lib/config.js';

/** One open task per record (#2756), stated by `uq_work_order_open_source`. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

// Every kind's position setting names the same value, so each kind is checked alike.
const setting = { position: '' };
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: async (key: string) => (key.endsWith('PositionId') ? setting.position : '')
}));

const { openSourcedTask, closeSourcedTasks, openSourceIds } = await import('./sourced-tasks');

const input = { source: 'restock' as const, sourceId: 'item-1', title: 'Restock picks' };
const routing = (id: string) =>
	sqlite.prepare(`select position_id, group_id from work_order where id = ?`).get(id);

beforeEach(() => {
	setting.position = '';
	sqlite.exec(`
		delete from work_order_assignee; delete from work_order; delete from group_position;
		delete from "group"; delete from "user";
		insert into "user" (id, name, email) values ('u', 'U', 'u@example.com');
		insert into "group" (id, kind, name, slug, join_policy, deleted_at) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only', null),
			('gone', 'committee', 'Gone', 'gone', 'invite_only', 1),
			('band', 'band', 'Band', 'band', 'invite_only', null);
		insert into group_position (id, group_id, name) values
			('booker', 'booking', 'Booker'), ('old', 'gone', 'Old'), ('singer', 'band', 'Singer');
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

	// #2940: insurance and door payment tasks opened with no position.
	it.each(taskSources)('a %s task waits on the configured position', async (source) => {
		setting.position = 'booker';
		const { id } = await openSourcedTask({ source, sourceId: 'r', title: 'T' });
		expect(routing(id)).toEqual({ position_id: 'booker', group_id: 'booking' });
	});

	it.each([
		['no setting', ''],
		['a position that no longer exists', 'missing'],
		['a deleted committee', 'old'],
		["a band's position", 'singer']
	])('%s leaves the task with no position', async (_, position) => {
		setting.position = position;
		const { id } = await openSourcedTask(input);
		expect(routing(id)).toEqual({ position_id: null, group_id: null });
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
