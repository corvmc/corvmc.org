import { describe, it, expect, vi, beforeEach } from 'vitest';
import { relatedSubjectTypes } from '#lib/utils/related-tasks.js';

/**
 * How a record finds its tasks (#2630), on a real SQLite: each relation's
 * condition, closest first, and a task listed once under its closest relation.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { relatedTasks, relatedTaskWhere, resolvingTypes } = await import('./related-tasks');
const { listTaskCatalogue } = await import('#lib/server/volunteer/task-catalogue.js');

const NOW = new Date('2026-06-15T12:00:00Z');
const at = (hours: number) => Math.floor(NOW.getTime() / 1000) + hours * 3600;

beforeEach(() => {
	for (const table of [
		'work_order',
		'project_committee',
		'project',
		'event_listing',
		'"group"',
		'volunteer_role'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into volunteer_role (id, name) values ('door', 'Door');
		insert into project (id, name, kind, status) values
			('show', 'Two-night show', 'production', 'in_progress'),
			('reno', 'Renovation', 'general', 'in_progress');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id) values
			('fri', 'Friday', ${at(24)}, ${at(28)}, 'published', 'cmc', 'show', 'u', 'show'),
			('sat', 'Saturday', ${at(48)}, ${at(52)}, 'published', 'cmc', 'show', 'u', 'show'),
			('loose', 'Open mic', ${at(72)}, ${at(76)}, 'published', 'cmc', 'show', 'u', null);
		insert into "group" (id, name, slug, kind) values
			('booking', 'Booking', 'booking', 'committee'),
			('other', 'Other', 'other', 'committee');
		insert into project_committee (project_id, group_id, role) values ('reno', 'booking', 'owner');

		insert into work_order (id, title, event_id, project_id) values
			('fri-doors', 'Doors', 'fri', 'show'),
			('fri-only', 'Sweep', 'fri', null),
			('sat-doors', 'Doors', 'sat', 'show'),
			('sat-only', 'Sweep', 'sat', null),
			('posters', 'Posters', null, 'show');
		insert into work_order (id, title, event_id) values ('mic', 'Sign-up sheet', 'loose');
		insert into work_order (id, title, project_id, resolved_at) values
			('show-done', 'Book acts', 'show', ${at(-48)});
		insert into work_order (id, title, project_id, cancelled_at) values
			('show-off', 'Hire van', 'show', ${at(-48)});

		insert into work_order (id, title, group_id, project_id) values
			('owned-in-own-project', 'Quote', 'booking', 'reno'),
			('owned', 'Minutes', 'booking', null),
			('reno-other', 'Paint', 'other', 'reno');
		insert into work_order (id, title, project_id) values ('reno-loose', 'Sand', 'reno');
		insert into work_order (id, volunteer_role_id) values ('door-shift', 'door');
	`);
});

const ids = (groups: Awaited<ReturnType<typeof relatedTasks>>) =>
	groups.map((g) => ({ key: g.key, ids: g.tasks.map((t) => t.id).sort() }));

describe('relatedTasks', () => {
	it("lists one night's tasks under the event, and the rest of the show under the show", async () => {
		expect(ids(await relatedTasks({ type: 'event', id: 'fri' }, { now: NOW }))).toEqual([
			{ key: 'event', ids: ['fri-doors', 'fri-only'] },
			{ key: 'show', ids: ['posters', 'sat-doors', 'sat-only'] }
		]);
	});

	it('gives an event on no project only its own tasks', async () => {
		expect(ids(await relatedTasks({ type: 'event', id: 'loose' }, { now: NOW }))).toEqual([
			{ key: 'event', ids: ['mic'] }
		]);
	});

	it("lists a committee's own task once, under the committee, before its projects", async () => {
		expect(ids(await relatedTasks({ type: 'group', id: 'booking' }, { now: NOW }))).toEqual([
			{ key: 'group', ids: ['owned', 'owned-in-own-project'] },
			{ key: 'groupProjects', ids: ['reno-loose', 'reno-other'] }
		]);
	});

	it('includes done tasks only when asked, and never called-off ones', async () => {
		const open = await relatedTasks({ type: 'project', id: 'show' }, { now: NOW });
		expect(open[0].tasks.map((t) => t.id)).not.toContain('show-done');
		const all = await relatedTasks(
			{ type: 'project', id: 'show' },
			{ now: NOW, includeDone: true }
		);
		expect(all[0].tasks.map((t) => t.id)).toContain('show-done');
		expect(all[0].tasks.map((t) => t.id)).not.toContain('show-off');
	});

	it('limits each relation and says there is more', async () => {
		const [group] = await relatedTasks(
			{ type: 'project', id: 'show' },
			{ now: NOW, limitPerRelation: 2 }
		);
		expect(group.tasks).toHaveLength(2);
		expect(group.more).toBe(true);
	});

	it('finds a role’s tasks', async () => {
		expect(ids(await relatedTasks({ type: 'role', id: 'door' }, { now: NOW }))).toEqual([
			{ key: 'role', ids: ['door-shift'] }
		]);
	});

	it('returns nothing for a type with no resolver', async () => {
		expect(await relatedTasks({ type: 'member', id: 'nia' }, { now: NOW })).toEqual([]);
		expect(relatedTaskWhere({ type: 'member', id: 'nia' })).toBeNull();
	});
});

describe('relatedTaskWhere', () => {
	it('narrows the Tasks table to every relation at once', async () => {
		const where = relatedTaskWhere({ type: 'event', id: 'sat' }) ?? undefined;
		const rows = await listTaskCatalogue({ where }, NOW);
		expect(rows.map((r) => r.id).sort()).toEqual([
			'fri-doors',
			'fri-only',
			'posters',
			'sat-doors',
			'sat-only'
		]);
	});
});

describe('the registry', () => {
	// Adding a type is a deliberate choice: this list moves with it.
	it('resolves exactly these subject types', () => {
		expect([...resolvingTypes].sort()).toEqual(
			['event', 'group', 'project', 'recurring_work', 'role'].sort()
		);
		for (const type of resolvingTypes) expect(relatedSubjectTypes).toContain(type);
	});
});
