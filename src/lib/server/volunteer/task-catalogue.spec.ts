import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Tasks table's one query (#2625), against a real SQLite: every task in a
 * project or none, committee work and work with no role included, with its
 * live shifts summed and called-off work left out.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listTaskCatalogue } = await import('./task-catalogue');

const NOW = new Date('2026-06-15T12:00:00Z');
const at = (hours: number) => Math.floor(NOW.getTime() / 1000) + hours * 3600;

beforeEach(() => {
	for (const table of [
		'contractor_job',
		'organization',
		'volunteer_signup',
		'volunteer_shift',
		'work_order_assignee',
		'work_order',
		'project',
		'volunteer_profile',
		'volunteer_role',
		'"user"'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into "user" (id, name, email) values ('nia', 'Nia', 'nia@example.com');
		insert into volunteer_profile (user_id, first_name, last_name, is_adult, status) values
			('nia', 'Nia', 'O', 1, 'active');
		insert into volunteer_role (id, name) values ('door', 'Door');
		insert into project (id, name, kind, status) values ('p1', 'Renovation', 'general', 'in_progress');
		insert into work_order (id, title, project_id) values ('in-project', 'Paint', 'p1');
		insert into work_order (id, title) values ('loose', 'Fix the amp');
		insert into work_order (id, volunteer_role_id) values ('shifted', 'door');
		insert into work_order (id, title, resolved_at) values ('done', 'Old job', ${at(-48)});
		insert into work_order (id, title, cancelled_at) values ('off', 'Called off', ${at(-48)});
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity) values
			('past', 'shifted', ${at(-30)}, ${at(-28)}, 1),
			('next', 'shifted', ${at(24)}, ${at(26)}, 3),
			('later', 'shifted', ${at(48)}, ${at(50)}, 2);
		insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', 'next', 'nia', 'confirmed');
		insert into work_order_assignee (work_order_id, user_id) values ('loose', 'nia');
		insert into work_order (id, title, resolved_at) values ('owed', 'Rewire', ${at(-24)});
		insert into organization (id, name) values ('c1', 'Benton');
		insert into contractor_job (id, organization_id, work_order_id, status) values
			('j1', 'c1', 'owed', 'completed');
	`);
});

const byId = async (filters = {}) =>
	new Map((await listTaskCatalogue(filters, NOW)).map((r) => [r.id, r]));

describe('listTaskCatalogue', () => {
	it('lists open tasks in a project or none, and leaves out done and called-off ones', async () => {
		const rows = await byId();
		expect([...rows.keys()].sort()).toEqual(['in-project', 'loose', 'shifted']);
		expect(rows.get('in-project')).toMatchObject({
			projectName: 'Renovation',
			projectKind: 'general',
			projectStatus: 'in_progress'
		});
		expect(rows.get('loose')).toMatchObject({ projectId: null, assignees: 1, shifts: 0 });
	});

	it('includes done tasks when asked, or when one still owes an invoice', async () => {
		expect((await byId()).has('owed')).toBe(false);
		expect((await byId({ includeDone: true })).has('done')).toBe(true);
		const named = await byId({ withAwaitingInvoice: true });
		expect([...named.keys()].sort()).toEqual(['in-project', 'loose', 'owed', 'shifted']);
	});

	it('sums the live shifts and dates the task by the next one still to end', async () => {
		const row = (await byId()).get('shifted')!;
		expect(row).toMatchObject({ shifts: 3, capacity: 6, claimed: 1, roleName: 'Door' });
		expect(row.shiftAt?.getTime()).toBe(at(24) * 1000);
	});

	it('filters by role, and by project for a project page', async () => {
		expect([...(await byId({ volunteerRoleId: 'door' })).keys()]).toEqual(['shifted']);
		expect([...(await byId({ projectId: 'p1' })).keys()]).toEqual(['in-project']);
	});
});
