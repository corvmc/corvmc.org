import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The dashboard's own tasks (#2768), against a real SQLite: which open tasks
 * wait on a user, in what order, and what each is about.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listMyWork } = await import('./my-work');

const NOW = new Date('2026-11-13T18:00:00Z');
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeEach(() => {
	sqlite.exec(`
		delete from work_order_link; delete from work_order_assignee; delete from work_order;
		delete from group_member; delete from "group"; delete from organization; delete from "user";
		insert into "user" (id, name, email) values
			('me', 'Me', 'me@example.com'), ('other', 'Other', 'other@example.com');
		insert into "group" (id, kind, name, slug, join_policy) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only'),
			('gone', 'committee', 'Gone', 'gone', 'invite_only'),
			('club', 'club', 'Jazz Club', 'jazz', 'invite_only');
		insert into group_member (id, group_id, user_id, role, status) values
			('m1', 'booking', 'me', 'member', 'active'),
			('m2', 'gone', 'me', 'member', 'inactive'),
			('m3', 'club', 'me', 'member', 'active');
		insert into organization (id, name) values ('o1', 'Amp Shop');
	`);
});

function task(id: string, cols: { due?: string; group?: string; resolved?: boolean } = {}) {
	sqlite
		.prepare(
			`insert into work_order (id, title, due_at, group_id, resolved_at, created_at) values (?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			id,
			cols.due ? sec(cols.due) : null,
			cols.group ?? null,
			cols.resolved ? sec('2026-11-01T00:00:00Z') : null,
			sec('2026-10-01T00:00:00Z')
		);
}

const assign = (id: string, userId = 'me', completed = false) =>
	sqlite
		.prepare(
			`insert into work_order_assignee (work_order_id, user_id, completed_at) values (?, ?, ?)`
		)
		.run(id, userId, completed ? sec('2026-11-10T00:00:00Z') : null);

const ids = async () => (await listMyWork('me', NOW)).map((t) => t.id);

describe('listMyWork', () => {
	it('holds open tasks assigned to the user, not ones they finished or others hold', async () => {
		task('mine');
		task('done-by-me');
		task('resolved', { resolved: true });
		task('theirs');
		assign('mine');
		assign('done-by-me', 'me', true);
		assign('resolved');
		assign('theirs', 'other');

		expect(await ids()).toEqual(['mine']);
	});

	it('holds a committee seat’s unassigned tasks, only for an active seat on a committee', async () => {
		task('committee', { group: 'booking' });
		task('committee-taken', { group: 'booking' });
		task('lapsed-seat', { group: 'gone' });
		task('club-work', { group: 'club' });
		assign('committee-taken', 'other');

		expect(await ids()).toEqual(['committee']);
	});

	it('puts overdue first, then soonest, then undated', async () => {
		for (const [id, due] of [
			['undated', undefined],
			['next-week', '2026-11-20T18:00:00Z'],
			['tomorrow', '2026-11-14T18:00:00Z'],
			['late', '2026-11-10T18:00:00Z']
		] as const) {
			task(id, { due });
			assign(id);
		}

		expect(await ids()).toEqual(['late', 'tomorrow', 'next-week', 'undated']);
	});

	it('names the record a task is about', async () => {
		task('about');
		task('plain');
		assign('about');
		assign('plain');
		sqlite.exec(
			`insert into work_order_link (id, work_order_id, organization_id) values ('l1', 'about', 'o1')`
		);

		const rows = await listMyWork('me', NOW);
		expect(Object.fromEntries(rows.map((t) => [t.id, t.about]))).toEqual({
			about: { type: 'organization', id: 'o1' },
			plain: null
		});
	});
});
