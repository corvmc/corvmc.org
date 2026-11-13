import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The member side of a record's cards (#2630 phase 4), on a real SQLite: a
 * member sees the tasks assigned to them or owned by a club or committee they
 * sit on, and the board's open shifts with their own sign-up facts.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { isPublicListing, memberRelatedShifts, memberRelatedTasks } =
	await import('./member-related');

const NOW = new Date('2026-06-15T12:00:00Z');
const at = (hours: number) => Math.floor(NOW.getTime() / 1000) + hours * 3600;

beforeEach(() => {
	for (const table of [
		'volunteer_role_certification',
		'volunteer_certification',
		'volunteer_signup',
		'volunteer_shift',
		'work_order_assignee',
		'work_order',
		'project_committee',
		'project',
		'group_member',
		'"group"',
		'event_listing',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into user (id, name, email) values
			('ada', 'Ada', 'ada@example.com'), ('bo', 'Bo', 'bo@example.com');
		insert into volunteer_role (id, name) values ('door', 'Door'), ('sound', 'Sound');
		insert into "group" (id, name, slug, kind) values
			('booking', 'Booking', 'booking', 'committee'),
			('other', 'Other', 'other', 'committee'),
			('band', 'Band', 'band', 'band');
		insert into group_member (id, group_id, user_id, role, status) values
			('m1', 'booking', 'ada', 'member', 'active'),
			('m2', 'band', 'ada', 'member', 'active'),
			('m3', 'other', 'ada', 'member', 'invited');
		insert into project (id, name, kind, status) values
			('show', 'Show', 'production', 'in_progress'),
			('reno', 'Renovation', 'general', 'in_progress');
		insert into project_committee (project_id, group_id, role) values
			('show', 'booking', 'owner'), ('reno', 'other', 'owner');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id) values
			('fri', 'Friday', ${at(24)}, ${at(28)}, 'published', 'cmc', 'show', 'ada', 'show'),
			('draft', 'Draft', ${at(24)}, ${at(28)}, 'draft', 'cmc', 'show', 'ada', null);

		insert into work_order (id, title, event_id, project_id, group_id) values
			('committee-show', 'Posters', 'fri', 'show', null),
			('owned', 'Minutes', null, null, 'booking'),
			('band-owned', 'Setlist', null, null, 'band'),
			('invited-only', 'Paint', null, 'reno', null),
			('assigned', 'Sweep', 'fri', null, null),
			('stranger', 'Mop', 'fri', null, null);
		insert into work_order_assignee (work_order_id, user_id) values ('assigned', 'ada');

		insert into volunteer_certification (id, name) values ('cleared', 'Sound cleared');
		insert into volunteer_role_certification (volunteer_role_id, certification_id) values ('sound', 'cleared');
		insert into work_order (id, volunteer_role_id, event_id) values
			('door', 'door', 'fri'), ('sound', 'sound', 'fri');
		insert into work_order (id, volunteer_role_id, event_id, resolved_at) values
			('done', 'door', 'fri', ${at(-1)});
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity) values
			('s-door', 'door', ${at(23)}, ${at(28)}, 2),
			('s-sound', 'sound', ${at(23)}, ${at(28)}, 1),
			('s-started', 'door', ${at(-1)}, ${at(2)}, 1),
			('s-done', 'done', ${at(23)}, ${at(28)}, 1);
		insert into volunteer_signup (id, shift_id, user_id, status) values
			('su-ada', 's-door', 'ada', 'claimed'),
			('su-bo', 's-door', 'bo', 'confirmed');
	`);
});

const taskIds = (r: Awaited<ReturnType<typeof memberRelatedTasks>>) =>
	r.groups.flatMap((g) => g.tasks.map((t) => t.id)).sort();

describe('memberRelatedTasks', () => {
	it("shows a member their committee's work and their own tasks, nobody else's", async () => {
		const r = await memberRelatedTasks({ type: 'event', id: 'fri' }, 'ada', { now: NOW });
		expect(taskIds(r)).toEqual(['assigned', 'committee-show']);
		expect(r.mine).toEqual(['assigned']);
	});

	it('leaves out a band, and a committee the member is only invited to', async () => {
		for (const id of ['band', 'other']) {
			const r = await memberRelatedTasks({ type: 'group', id }, 'ada', { now: NOW });
			expect(taskIds(r)).toEqual([]);
		}
		const own = await memberRelatedTasks({ type: 'group', id: 'booking' }, 'ada', { now: NOW });
		expect(taskIds(own)).toEqual(['committee-show', 'owned']);
	});

	it('shows a member on no roster only what is assigned to them', async () => {
		const r = await memberRelatedTasks({ type: 'event', id: 'fri' }, 'bo', { now: NOW });
		expect(taskIds(r)).toEqual([]);
	});
});

describe('memberRelatedShifts', () => {
	it("lists the board's open shifts with the member's own sign-up and missing clearances", async () => {
		const groups = await memberRelatedShifts({ type: 'event', id: 'fri' }, 'ada', { now: NOW });
		const shifts = groups.flatMap((g) => g.shifts);
		expect(shifts.map((s) => s.shiftId).sort()).toEqual(['s-door', 's-sound']);
		const door = shifts.find((s) => s.shiftId === 's-door')!;
		expect(door.signup).toEqual({ status: 'claimed', id: 'su-ada', missing: [] });
		expect(door.claimed).toBe(2);
		expect(shifts.find((s) => s.shiftId === 's-sound')!.signup).toEqual({
			status: null,
			id: null,
			missing: ['Sound cleared']
		});
	});

	it('gives another member the same shifts with their own facts', async () => {
		const groups = await memberRelatedShifts({ type: 'event', id: 'fri' }, 'bo', { now: NOW });
		const door = groups.flatMap((g) => g.shifts).find((s) => s.shiftId === 's-door')!;
		expect(door.signup.status).toBe('confirmed');
	});
});

describe('isPublicListing', () => {
	it('admits a published listing and refuses a draft or an unknown one', async () => {
		expect(await isPublicListing('fri', null)).toBe(true);
		expect(await isPublicListing('draft', null)).toBe(false);
		expect(await isPublicListing('nope', null)).toBe(false);
	});
});
