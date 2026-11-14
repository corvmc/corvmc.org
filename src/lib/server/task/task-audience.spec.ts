import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Who hears about a task (#2990), against a real SQLite: its position's
 * holders, else its committee's seats, else every holder of the capability.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const holders = vi.fn(async (_cap: string) => [
	{ id: 'coord', name: 'Coord', email: 'coord@example.com' }
]);
vi.mock('#lib/server/authorization.js', () => ({
	listUsersWithCapability: (cap: string) => holders(cap)
}));

const { taskAudiences, taskNoticeRecipients, showLeads } = await import('./task-audience');

const ids = (list: { userId: string }[] | undefined) => (list ?? []).map((r) => r.userId);

beforeEach(() => {
	holders.mockClear();
	sqlite.exec(`
		delete from work_order; delete from production; delete from event_listing; delete from project;
		delete from group_position_holder; delete from group_position;
		delete from group_member; delete from "group"; delete from "user";
		insert into "user" (id, name, email, deleted_at) values
			('ana', 'Ana', 'ana@example.com', null), ('ben', 'Ben', 'ben@example.com', null),
			('cy', 'Cy', 'cy@example.com', null), ('gone', 'Gone', 'gone@example.com', unixepoch()),
			('lead', 'Lead', 'lead@example.com', null);
		insert into "group" (id, kind, name, slug, join_policy) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only'),
			('sound', 'committee', 'Sound', 'sound', 'invite_only'),
			('empty', 'committee', 'Empty', 'empty', 'invite_only');
		insert into group_member (id, group_id, user_id, role, status) values
			('m-ana', 'booking', 'ana', 'member', 'active'),
			('m-ben', 'booking', 'ben', 'member', 'active'),
			('m-gone', 'booking', 'gone', 'member', 'active'),
			('m-cy', 'sound', 'cy', 'member', 'inactive');
		insert into group_position (id, group_id, name) values
			('treasurer', 'booking', 'Treasurer'), ('vacant', 'booking', 'Vacant'),
			('engineer', 'sound', 'Engineer');
		insert into group_position_holder (position_id, member_id) values
			('treasurer', 'm-ben'), ('engineer', 'm-cy');
		insert into work_order (id, title, group_id, position_id) values
			('held', 'Count the till', 'booking', 'treasurer'),
			('vacant', 'Nobody yet', 'booking', 'vacant'),
			('untagged', 'Book acts', 'booking', null),
			('lapsed', 'Mix', 'sound', 'engineer'),
			('empty', 'Nothing', 'empty', null),
			('staff', 'Staff work', null, null);
	`);
});

describe('taskAudiences', () => {
	it('goes to the position holders when the position is filled', async () => {
		const a = (await taskAudiences(['held'])).get('held');
		expect(a?.via).toBe('position');
		expect(ids(a?.recipients)).toEqual(['ben']);
	});

	it('goes to the live seats of the committee when the position is vacant or absent', async () => {
		const map = await taskAudiences(['vacant', 'untagged']);
		for (const id of ['vacant', 'untagged']) {
			expect(map.get(id)?.via).toBe('department');
			expect(ids(map.get(id)?.recipients)).toEqual(['ana', 'ben']);
		}
	});

	it('leaves out a task whose committee has nobody, or that no committee owns', async () => {
		const map = await taskAudiences(['lapsed', 'empty', 'staff']);
		expect([...map.keys()]).toEqual([]);
	});
});

describe('taskNoticeRecipients', () => {
	it('falls back to every holder of the capability only when nobody is routed', async () => {
		expect(ids(await taskNoticeRecipients('held', 'volunteer.manageShifts'))).toEqual(['ben']);
		expect(holders).not.toHaveBeenCalled();
		expect(ids(await taskNoticeRecipients('staff', 'volunteer.manageShifts'))).toEqual(['coord']);
		expect(holders).toHaveBeenCalledWith('volunteer.manageShifts');
	});
});

describe('showLeads', () => {
	it("names each show's event lead", async () => {
		sqlite.exec(`
			insert into project (id, name, kind) values ('pr', 'Show', 'production'), ('pr2', 'Other', 'production');
			insert into production (id, project_id, producer_user_id) values ('pn', 'pr', 'lead'), ('pn2', 'pr2', null);
			insert into event_listing (id, title, starts_at, ends_at, kind, source, status, project_id, created_by_user_id) values
				('ev', 'Show', unixepoch(), unixepoch() + 3600, 'show', 'cmc', 'published', 'pr', 'ana'),
				('ev2', 'Other', unixepoch(), unixepoch() + 3600, 'show', 'cmc', 'published', 'pr2', 'ana');
		`);
		const leads = await showLeads(['ev', 'ev2']);
		expect(leads.get('ev')?.userId).toBe('lead');
		expect(leads.has('ev2')).toBe(false);
	});
});
