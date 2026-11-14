import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Who may act on a task (#2989), against a real SQLite: the assignee, a live
 * seat on the committee that owns it, or a holder of the task's grant with the
 * scope read off the row.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const grant = vi.fn(async (..._a: unknown[]) => false);
vi.mock('#lib/server/authorization.js', () => ({
	userHasCapability: (...a: unknown[]) => grant(...a),
	requireUser: () => ({ id: 'me' })
}));

const { canActOnTask } = await import('./can-act');

beforeEach(() => {
	grant.mockReset().mockResolvedValue(false);
	sqlite.exec(`
		delete from work_order_assignee; delete from work_order;
		delete from group_member; delete from "group"; delete from "user";
		insert into "user" (id, name, email) values
			('me', 'Me', 'me@example.com'), ('other', 'Other', 'other@example.com');
		insert into "group" (id, kind, name, slug, join_policy, deleted_at) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only', null),
			('sound', 'committee', 'Sound', 'sound', 'invite_only', null),
			('lapsed', 'committee', 'Lapsed', 'lapsed', 'invite_only', null),
			('closed', 'committee', 'Closed', 'closed', 'invite_only', unixepoch()),
			('club', 'club', 'Jazz Club', 'jazz', 'invite_only', null);
		insert into group_member (id, group_id, user_id, role, status) values
			('m1', 'booking', 'me', 'member', 'active'),
			('m2', 'lapsed', 'me', 'member', 'inactive'),
			('m3', 'closed', 'me', 'member', 'active'),
			('m4', 'club', 'me', 'member', 'active'),
			('m5', 'sound', 'other', 'member', 'active');
		insert into work_order (id, title, group_id) values
			('booking-task', 'Book acts', 'booking'),
			('sound-task', 'Wire the stage', 'sound'),
			('lapsed-task', 'Old work', 'lapsed'),
			('closed-task', 'Gone work', 'closed'),
			('club-task', 'Club work', 'club'),
			('staff-task', 'Staff work', null);
	`);
});

describe('canActOnTask', () => {
	it('admits a seat on the owning committee with no grant (case 1)', async () => {
		expect(await canActOnTask('me', 'booking-task')).toBe('department');
	});

	it('admits the department whether or not somebody else holds the task', async () => {
		sqlite.exec(
			`insert into work_order_assignee (work_order_id, user_id) values ('booking-task', 'other')`
		);
		expect(await canActOnTask('me', 'booking-task')).toBe('department');
	});

	it('refuses another committee, a lapsed seat, a deleted committee and a club', async () => {
		for (const id of ['sound-task', 'lapsed-task', 'closed-task', 'club-task', 'staff-task']) {
			expect(await canActOnTask('me', id)).toBeNull();
		}
	});

	it('admits the assignee of a task outside their committees', async () => {
		sqlite.exec(
			`insert into work_order_assignee (work_order_id, user_id) values ('sound-task', 'me')`
		);
		expect(await canActOnTask('me', 'sound-task')).toBe('assignee');
	});

	it("admits a grant holder, scoped to the row's committee and project", async () => {
		grant.mockResolvedValue(true);
		expect(await canActOnTask('me', 'sound-task')).toBe('grant');
		expect(grant).toHaveBeenCalledWith('me', 'volunteer.manageShifts', {
			groupId: 'sound',
			projectId: null
		});
	});

	it('refuses a task that does not exist without asking for a grant', async () => {
		grant.mockResolvedValue(true);
		expect(await canActOnTask('me', 'no-such-task')).toBeNull();
		expect(grant).not.toHaveBeenCalled();
	});
});
