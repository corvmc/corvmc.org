import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A project's task list, against a real SQLite: ordering, sections, the
 * assignment switches and derived completion are all writes and `WHERE`s that
 * a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('outside a request');
	}
}));
vi.mock('$lib/server/volunteer/volunteer-profile-service', () => ({
	requireActiveVolunteer: vi.fn(async () => undefined)
}));
const emit = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => undefined));
vi.mock('$lib/server/events', () => ({ domainEvents: { emit } }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/volunteer/member-certification-service', () => ({
	missingRequirements: vi.fn(async () => [])
}));

const tasks = await import('./project-task-service');
const sections = await import('./project-section-service');
const { applyDutyList } = await import('$lib/server/volunteer/duty-list-service');

const PROJECT = 'proj-1';
const OTHER = 'proj-2';
const ROLE = 'role-1';
const STAFF = 'usr-staff';
const ADA = 'usr-ada';
const BO = 'usr-bo';
const CAM = 'usr-cam';
const OUTSIDER = 'usr-outsider';
const COMMITTEE = 'grp-facilities';

function insert(table: string, row: Record<string, unknown>) {
	const keys = Object.keys(row);
	sqlite
		.prepare(
			`insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')})
				values (${keys.map(() => '?').join(', ')})`
		)
		.run(...keys.map((k) => row[k]));
}

const one = <T>(q: string, ...args: unknown[]) => sqlite.prepare(q).get(...args) as T;
const all = <T>(q: string, ...args: unknown[]) => sqlite.prepare(q).all(...args) as T[];
const order = (sectionId: string | null) =>
	all<{ id: string }>(
		`select id from work_order where project_id = ? and section_id is ? order by sort_order, created_at`,
		PROJECT,
		sectionId
	).map((r) => r.id);
const audits = (action: string) =>
	all<{ subject_id: string; details: string }>(
		`select subject_id, details from audit_log where action = ?`,
		action
	).map((r) => ({ id: r.subject_id, ...JSON.parse(r.details) }));

beforeEach(() => {
	emit.mockClear();
	for (const t of [
		'audit_log',
		'contractor_job',
		'work_task',
		'volunteer_signup',
		'work_order',
		'duty_list_item',
		'duty_list',
		'project_section',
		'project_committee',
		'group_member',
		'"group"',
		'model_has_roles',
		'roles',
		'volunteer_role',
		'project',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	for (const id of [STAFF, ADA, BO, CAM, OUTSIDER]) {
		insert('user', { id, name: id.slice(4), email: `${id}@example.com`, email_verified: 0 });
	}
	insert('project', { id: PROJECT, name: 'Renovation', starts_at: 1_900_000_000 });
	insert('project', { id: OTHER, name: 'Other' });
	insert('volunteer_role', { id: ROLE, name: 'Work Party', is_active: 1 });
	insert('roles', { id: 1, name: 'admin', guard_name: 'web' });
	insert('roles', { id: 2, name: 'not-a-position', guard_name: 'web' });
	insert('model_has_roles', { role_id: 1, user_id: STAFF });
	insert('model_has_roles', { role_id: 2, user_id: OUTSIDER });
	insert('"group"', { id: COMMITTEE, name: 'Facilities', slug: 'facilities', kind: 'committee' });
	insert('project_committee', { project_id: PROJECT, group_id: COMMITTEE, role: 'owner' });
	for (const u of [ADA, BO, CAM]) {
		insert('group_member', {
			id: `gm-${u}`,
			group_id: COMMITTEE,
			user_id: u,
			role: 'member',
			status: 'active'
		});
	}
});

const task = (id: string, cols: Record<string, unknown> = {}) =>
	insert('work_order', { id, project_id: PROJECT, title: id, capacity: 1, ...cols });

describe('inline create', () => {
	it('makes a task with a title and nothing else, at the end of its section', async () => {
		const s = await sections.createSection(PROJECT, 'Prep');
		task('first', { section_id: s.id, sort_order: 0 });
		const row = await tasks.createTask({
			projectId: PROJECT,
			title: 'Buy paint',
			sectionId: s.id,
			createdByUserId: STAFF
		});
		expect(row).toMatchObject({ volunteerRoleId: null, postedAt: null, sortOrder: 1 });
		expect(order(s.id)).toEqual(['first', row.id]);
		expect(audits('work_order.created')).toEqual([
			{ id: row.id, projectId: PROJECT, title: 'Buy paint' }
		]);
	});

	it("refuses another project's section", async () => {
		const s = await sections.createSection(OTHER, 'Prep');
		await expect(
			tasks.createTask({ projectId: PROJECT, title: 'x', sectionId: s.id, createdByUserId: STAFF })
		).rejects.toBeInstanceOf(sections.SectionNotFoundError);
	});
});

describe('sections', () => {
	it('deleting one keeps its tasks, at the end of the unlabelled group', async () => {
		const s = await sections.createSection(PROJECT, 'Electrical');
		task('loose', { sort_order: 0 });
		task('a', { section_id: s.id, sort_order: 0 });
		task('b', { section_id: s.id, sort_order: 1 });
		expect(await sections.deleteSection(PROJECT, s.id)).toBe(2);
		expect(order(null)).toEqual(['loose', 'a', 'b']);
		expect(await sections.listSections(PROJECT)).toEqual([]);
	});

	it('refuses a second section with the same name', async () => {
		await sections.createSection(PROJECT, 'Prep');
		await expect(sections.createSection(PROJECT, ' Prep ')).rejects.toBeInstanceOf(
			sections.SectionValidationError
		);
	});

	it('reorders only with every section named once', async () => {
		const a = await sections.createSection(PROJECT, 'A');
		const b = await sections.createSection(PROJECT, 'B');
		await sections.reorderSections(PROJECT, [b.id, a.id]);
		expect((await sections.listSections(PROJECT)).map((s) => s.name)).toEqual(['B', 'A']);
		await expect(sections.reorderSections(PROJECT, [b.id])).rejects.toBeInstanceOf(
			sections.SectionValidationError
		);
	});
});

describe('moving a task', () => {
	it('lands at the index and renumbers the section it joins', async () => {
		const s = await sections.createSection(PROJECT, 'Close-out');
		task('x', { section_id: s.id, sort_order: 0 });
		task('y', { section_id: s.id, sort_order: 5 });
		task('mover', { sort_order: 0 });
		await tasks.moveTask(PROJECT, 'mover', { sectionId: s.id, index: 1 });
		expect(
			all<{ id: string; sort_order: number }>(
				`select id, sort_order from work_order where section_id = ? order by sort_order`,
				s.id
			)
		).toEqual([
			{ id: 'x', sort_order: 0 },
			{ id: 'mover', sort_order: 1 },
			{ id: 'y', sort_order: 2 }
		]);
		expect(audits('work_order.moved')).toEqual([
			{ id: 'mover', fromSectionId: null, toSectionId: s.id }
		]);
	});

	it('refuses a work order on another project', async () => {
		insert('work_order', { id: 'theirs', project_id: OTHER, title: 't' });
		await expect(
			tasks.moveTask(PROJECT, 'theirs', { sectionId: null, index: 0 })
		).rejects.toBeInstanceOf(tasks.TaskNotFoundError);
	});
});

describe('applying a duty list to a project', () => {
	it('creates sections by name, and reuses them the next time', async () => {
		insert('duty_list', {
			id: 'dl',
			name: 'Close-out',
			anchor: 'project_start',
			subject: 'project'
		});
		insert('duty_list_item', {
			id: 'i1',
			duty_list_id: 'dl',
			volunteer_role_id: ROLE,
			due_offset_minutes: 60,
			section: 'Load-in',
			sort_order: 0
		});
		insert('duty_list_item', {
			id: 'i2',
			duty_list_id: 'dl',
			volunteer_role_id: ROLE,
			due_offset_minutes: 60,
			section: 'Load-in',
			sort_order: 1
		});
		await applyDutyList('dl', { kind: 'project', id: PROJECT }, STAFF);
		sqlite.exec(`update work_order set cancelled_at = 1`);
		await applyDutyList('dl', { kind: 'project', id: PROJECT }, STAFF);

		const [loadIn, ...rest] = await sections.listSections(PROJECT);
		expect(rest).toEqual([]);
		expect(loadIn.name).toBe('Load-in');
		expect(
			all<{ sort_order: number }>(
				`select sort_order from work_order where section_id = ? order by sort_order`,
				loadIn.id
			).map((r) => r.sort_order)
		).toEqual([0, 1, 2, 3]);
	});
});

describe('assigning members', () => {
	it('needs a role, since hours are logged against it', async () => {
		task('t');
		await expect(tasks.assignMembers(PROJECT, 't', { userIds: [ADA] })).rejects.toBeInstanceOf(
			tasks.TaskValidationError
		);
	});

	it('raises the places when staff name more people than it has, and takes it off the board', async () => {
		task('t', { volunteer_role_id: ROLE, capacity: 1, posted_at: 1 });
		const result = await tasks.assignMembers(PROJECT, 't', { userIds: [ADA, BO, CAM] });
		expect(result).toMatchObject({ assigned: [ADA, BO, CAM], refused: [], mode: 'members' });
		expect(one(`select capacity, posted_at from work_order where id = 't'`)).toEqual({
			capacity: 3,
			posted_at: null
		});
		expect(audits('work_order.assigned')).toEqual([
			{ id: 't', from: 'open', to: 'members', cancelledSignups: 0 }
		]);
		expect(audits('work_order.member_assigned')).toHaveLength(3);
	});

	it('sets the role when one is given with the first person', async () => {
		task('t');
		await tasks.assignMembers(PROJECT, 't', { userIds: [ADA], volunteerRoleId: ROLE });
		expect(one(`select volunteer_role_id from work_order where id = 't'`)).toEqual({
			volunteer_role_id: ROLE
		});
	});

	it('keeps whoever claimed it when an open task becomes a members one', async () => {
		task('t', { volunteer_role_id: ROLE, capacity: 2, posted_at: 1 });
		insert('volunteer_signup', { id: 'su', shift_id: 't', user_id: ADA, status: 'claimed' });
		await tasks.assignMembers(PROJECT, 't', { userIds: [] });
		expect(one(`select status from volunteer_signup where id = 'su'`)).toEqual({
			status: 'claimed'
		});
		expect(one(`select posted_at from work_order where id = 't'`)).toEqual({ posted_at: null });
	});

	it('assigns only staff and members of the committee', async () => {
		task('t', { volunteer_role_id: ROLE });
		const picker = await tasks.listAssignableMembers(PROJECT, 't');
		expect(picker.map((m) => m.userId).sort()).toEqual([ADA, BO, CAM, STAFF].sort());
		await expect(tasks.assignMembers(PROJECT, 't', { userIds: [OUTSIDER] })).rejects.toBeInstanceOf(
			tasks.TaskValidationError
		);
	});

	it('refuses while a contractor is engaged on it', async () => {
		task('t', { volunteer_role_id: ROLE });
		const cols = all<{ name: string; notnull: number; dflt_value: unknown }>(
			`pragma table_info(contractor_job)`
		);
		const row: Record<string, unknown> = { id: 'cj', work_order_id: 't', status: 'completed' };
		for (const c of cols)
			if (!(c.name in row) && c.notnull && c.dflt_value === null) row[c.name] = 'x';
		insert('contractor_job', row);
		await expect(tasks.assignMembers(PROJECT, 't', { userIds: [ADA] })).rejects.toBeInstanceOf(
			tasks.TaskConflictError
		);
		await expect(
			tasks.openToVolunteers(PROJECT, 't', { postedByUserId: STAFF })
		).rejects.toBeInstanceOf(tasks.TaskConflictError);
	});
});

describe('opening to volunteers', () => {
	it('posts it, with a role and places', async () => {
		task('t');
		expect(
			await tasks.openToVolunteers(PROJECT, 't', {
				volunteerRoleId: ROLE,
				capacity: 4,
				postedByUserId: STAFF
			})
		).toBe('open');
		expect(one(`select capacity, posted_by_user_id from work_order where id = 't'`)).toEqual({
			capacity: 4,
			posted_by_user_id: STAFF
		});
	});
});

describe('unassigning', () => {
	it('warns how many are on it, then takes them off and tells them', async () => {
		task('t', { volunteer_role_id: ROLE, capacity: 2 });
		insert('volunteer_signup', { id: 'su-a', shift_id: 't', user_id: ADA, status: 'confirmed' });
		insert('volunteer_signup', { id: 'su-b', shift_id: 't', user_id: BO, status: 'claimed' });

		expect(await tasks.unassignTask(PROJECT, 't')).toEqual({
			status: 'needs_confirmation',
			liveSignups: 2
		});
		expect(all(`select 1 from volunteer_signup where status = 'cancelled'`)).toHaveLength(0);

		expect(await tasks.unassignTask(PROJECT, 't', { confirm: true })).toEqual({
			status: 'done',
			cancelledSignups: 2,
			mode: 'unassigned'
		});
		expect(all(`select 1 from volunteer_signup where status = 'cancelled'`)).toHaveLength(2);
		await new Promise((r) => setTimeout(r, 0));
		expect(emit.mock.calls.filter(([e]) => e === 'volunteer.signup_cancelled')).toHaveLength(2);
		expect(audits('work_order.assigned')).toEqual([
			{ id: 't', from: 'members', to: 'unassigned', cancelledSignups: 2 }
		]);
	});
});

describe('ticking and unticking', () => {
	it('needs a reason to tick a task with a done condition by hand', async () => {
		task('t', { done_when: 'tasks_ticked' });
		insert('work_task', { id: 'd', work_order_id: 't', label: 'Sweep', done: 0, sort_order: 0 });
		await expect(
			tasks.resolveTask(PROJECT, 't', { resolvedByUserId: STAFF })
		).rejects.toBeInstanceOf(tasks.TaskValidationError);

		await tasks.resolveTask(PROJECT, 't', { resolvedByUserId: STAFF, reason: 'Swept anyway' });
		expect(one(`select resolution_notes from work_order where id = 't'`)).toEqual({
			resolution_notes: 'Swept anyway'
		});
		expect(audits('work_order.resolved')).toEqual([
			{ id: 't', override: true, reason: 'Swept anyway' }
		]);

		await tasks.reopenTask(PROJECT, 't');
		expect(one(`select resolved_at, resolution_notes from work_order where id = 't'`)).toEqual({
			resolved_at: null,
			resolution_notes: null
		});
	});

	it('ticks a plain task with no reason', async () => {
		task('t');
		await tasks.resolveTask(PROJECT, 't', { resolvedByUserId: STAFF });
		expect(audits('work_order.resolved')).toEqual([{ id: 't', override: false, reason: null }]);
	});
});

describe('progress', () => {
	it('counts done over live, derived done included, cancelled left out', async () => {
		task('ticked', { resolved_at: 1 });
		task('derived', { done_when: 'tasks_ticked' });
		insert('work_task', {
			id: 'd',
			work_order_id: 'derived',
			label: 'x',
			done: 1,
			done_at: 1,
			sort_order: 0
		});
		task('open');
		task('called-off', { cancelled_at: 1 });
		expect(await tasks.getProjectProgress(PROJECT)).toEqual({ done: 2, total: 3 });

		const list = await tasks.listProjectTasks(PROJECT);
		expect(list.progress).toEqual({ done: 2, total: 3 });
		expect(list.tasks.find((t) => t.id === 'derived')).toMatchObject({
			state: 'done',
			mode: 'unassigned',
			duties: { done: 1, total: 1 }
		});
	});
});
