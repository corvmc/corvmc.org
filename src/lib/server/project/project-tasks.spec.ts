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

	it('compares names trimmed and case-insensitively', async () => {
		await sections.createSection(PROJECT, 'Prep');
		await expect(sections.createSection(PROJECT, 'prep')).rejects.toBeInstanceOf(
			sections.SectionValidationError
		);
		expect(await sections.listSections(PROJECT)).toHaveLength(1);
	});

	it('refuses renaming onto another section, but not recasing its own name', async () => {
		await sections.createSection(PROJECT, 'Prep');
		const other = await sections.createSection(PROJECT, 'Wiring');
		await expect(sections.renameSection(PROJECT, other.id, ' PREP')).rejects.toBeInstanceOf(
			sections.SectionValidationError
		);
		expect((await sections.renameSection(PROJECT, other.id, 'wiring')).name).toBe('wiring');
	});

	it('reuses an existing section for a duty list naming it in another case', async () => {
		const prep = await sections.createSection(PROJECT, 'Load-in');
		const map = await sections.ensureSections(PROJECT, ['load-in', 'Strike']);
		expect(map.get('load-in')).toBe(prep.id);
		expect((await sections.listSections(PROJECT)).map((s) => s.name)).toEqual([
			'Load-in',
			'Strike'
		]);
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

	it('assigns somebody missing a clearance, with the warning on the result and in the log', async () => {
		task('t', { volunteer_role_id: ROLE });
		const { missingRequirements } =
			await import('$lib/server/volunteer/member-certification-service');
		vi.mocked(missingRequirements).mockResolvedValueOnce([{ id: 'c1', name: 'Forklift' }]);

		const result = await tasks.assignMembers(PROJECT, 't', { userIds: [ADA] });
		if (result.status !== 'done') throw new Error('expected an assignment, not a warning');

		expect(result).toMatchObject({ assigned: [ADA], refused: [] });
		expect(result.warned).toEqual([{ userId: ADA, warnings: [expect.stringMatching(/Forklift/)] }]);
		expect(audits('work_order.assigned_over_warnings')).toEqual([
			expect.objectContaining({ id: 't', userId: ADA, warnings: result.warned[0].warnings })
		]);
	});

	it('assigns only staff and members of the committee', async () => {
		task('t', { volunteer_role_id: ROLE });
		const picker = await tasks.listAssignableMembers(PROJECT, 't');
		expect(picker.map((m) => m.userId).sort()).toEqual([ADA, BO, CAM, STAFF].sort());
		await expect(tasks.assignMembers(PROJECT, 't', { userIds: [OUTSIDER] })).rejects.toBeInstanceOf(
			tasks.TaskValidationError
		);
	});

	it('refuses once a contractor has done the work', async () => {
		task('t', { volunteer_role_id: ROLE });
		engagement('cj', 'completed');
		await expect(tasks.assignMembers(PROJECT, 't', { userIds: [ADA] })).rejects.toBeInstanceOf(
			tasks.TaskConflictError
		);
		await expect(
			tasks.openToVolunteers(PROJECT, 't', { postedByUserId: STAFF })
		).rejects.toBeInstanceOf(tasks.TaskConflictError);
	});
});

/** An engagement on task `t`, by a contractor named "Sparky". */
function engagement(id: string, status: string) {
	if (!one(`select 1 as x from contractor where id = 'ctr'`)) {
		const cols = all<{ name: string; notnull: number; dflt_value: unknown }>(
			`pragma table_info(contractor)`
		);
		const row: Record<string, unknown> = { id: 'ctr', name: 'Sparky' };
		for (const c of cols)
			if (!(c.name in row) && c.notnull && c.dflt_value === null) row[c.name] = 'x';
		insert('contractor', row);
	}
	insert('contractor_job', { id, work_order_id: 't', contractor_id: 'ctr', status });
}

describe('switching away from a contractor', () => {
	beforeEach(() => sqlite.exec(`delete from contractor`));

	it('warns whose engagement it cancels, then cancels it and assigns', async () => {
		task('t', { volunteer_role_id: ROLE });
		engagement('cj', 'booked');

		expect(await tasks.assignMembers(PROJECT, 't', { userIds: [ADA] })).toEqual({
			status: 'needs_confirmation',
			liveSignups: 0,
			engagement: { contractorName: 'Sparky', status: 'booked' }
		});
		expect(one(`select status from contractor_job where id = 'cj'`)).toEqual({ status: 'booked' });
		expect(all(`select 1 from volunteer_signup`)).toHaveLength(0);

		const done = await tasks.assignMembers(PROJECT, 't', { userIds: [ADA], confirm: true });
		expect(done).toMatchObject({ status: 'done', assigned: [ADA], mode: 'members' });
		expect(one(`select status from contractor_job where id = 'cj'`)).toEqual({
			status: 'cancelled'
		});
		expect(audits('work_order.assigned')).toEqual([
			{ id: 't', from: 'contractor', to: 'members', cancelledSignups: 0, calledOff: 'Sparky' }
		]);
	});

	it('cancels an asked engagement when opened to volunteers or unassigned', async () => {
		task('t', { volunteer_role_id: ROLE });
		engagement('cj', 'asked');
		expect(
			await tasks.openToVolunteers(PROJECT, 't', { postedByUserId: STAFF, confirm: true })
		).toEqual({ status: 'done', mode: 'open' });
		expect(one(`select status from contractor_job where id = 'cj'`)).toEqual({
			status: 'cancelled'
		});

		engagement('cj-2', 'asked');
		expect(await tasks.unassignTask(PROJECT, 't')).toMatchObject({
			status: 'needs_confirmation',
			engagement: { contractorName: 'Sparky', status: 'asked' }
		});
		expect(await tasks.unassignTask(PROJECT, 't', { confirm: true })).toMatchObject({
			status: 'done',
			mode: 'unassigned'
		});
		expect(one(`select status from contractor_job where id = 'cj-2'`)).toEqual({
			status: 'cancelled'
		});
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
		).toEqual({ status: 'done', mode: 'open' });
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
			liveSignups: 2,
			engagement: null
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

	it('counts many projects in one call, an empty project included', async () => {
		task('ticked', { resolved_at: 1 });
		task('open');
		insert('work_order', { id: 'theirs', project_id: OTHER, title: 't', resolved_at: 1 });
		const byProject = await tasks.listProjectProgress([PROJECT, OTHER, 'proj-empty']);
		expect(byProject.get(PROJECT)).toEqual({ done: 1, total: 2 });
		expect(byProject.get(OTHER)).toEqual({ done: 1, total: 1 });
		expect(byProject.get('proj-empty')).toEqual({ done: 0, total: 0 });
	});
});

describe('the rows the list draws', () => {
	it('carries the people, the engagement, the duties and the inherited committee', async () => {
		task('crew', { volunteer_role_id: ROLE, capacity: 3 });
		insert('volunteer_signup', { id: 'su-a', shift_id: 'crew', user_id: ADA, status: 'confirmed' });
		insert('volunteer_signup', { id: 'su-b', shift_id: 'crew', user_id: BO, status: 'cancelled' });

		task('wired');
		sqlite.exec(`delete from contractor`);
		insert('contractor', { id: 'ctr', name: 'Benton Electric', trade: 'electrical' });
		const base = { work_order_id: 'wired', contractor_id: 'ctr' };
		insert('contractor_job', { ...base, id: 'cj-old', status: 'declined', created_at: 1 });
		insert('contractor_job', {
			...base,
			id: 'cj-live',
			status: 'booked',
			quoted_cents: 22000,
			created_at: 2
		});
		insert('contractor_job', { ...base, id: 'cj-new', status: 'cancelled', created_at: 3 });

		task('checklist', { done_when: 'tasks_ticked', group_id: COMMITTEE });
		for (const [id, done, sort] of [
			['b', 0, 1],
			['a', 1, 0]
		] as const) {
			insert('work_task', {
				id,
				work_order_id: 'checklist',
				label: id,
				done,
				done_at: done ? 1 : null,
				sort_order: sort
			});
		}

		const list = await tasks.listProjectTasks(PROJECT);
		const row = (id: string) => list.tasks.find((t) => t.id === id)!;

		expect(list.committee).toEqual({ id: COMMITTEE, name: 'Facilities' });
		expect(row('crew').people.map((p) => p.userId)).toEqual([ADA]);
		expect(row('crew').engagement).toBeNull();
		expect(row('wired')).toMatchObject({
			mode: 'contractor',
			engagement: { id: 'cj-live', contractorName: 'Benton Electric', quotedCents: 22000 }
		});
		expect(row('checklist')).toMatchObject({
			groupName: 'Facilities',
			dutyItems: [
				{ id: 'a', done: true },
				{ id: 'b', done: false }
			],
			duties: { done: 1, total: 2 },
			outstanding: { kind: 'duties' }
		});
		expect(row('crew').outstanding).toBeNull();
	});
});

describe('delegating to a contractor', () => {
	it('warns about the people on it, then takes them off and books the engagement asked', async () => {
		task('t', { volunteer_role_id: ROLE, posted_at: 1, capacity: 2 });
		insert('volunteer_signup', { id: 'su-a', shift_id: 't', user_id: ADA, status: 'confirmed' });
		sqlite.exec(`delete from contractor`);
		insert('contractor', { id: 'ctr', name: 'Benton Electric', trade: 'electrical' });
		const input = { contractorId: 'ctr', quotedCents: 22000, requestedByUserId: STAFF };

		expect(await tasks.engageContractor(PROJECT, 't', input)).toEqual({
			status: 'needs_confirmation',
			liveSignups: 1,
			engagement: null
		});
		expect(one(`select count(*) n from contractor_job`)).toEqual({ n: 0 });

		const done = await tasks.engageContractor(PROJECT, 't', { ...input, confirm: true });
		expect(done).toMatchObject({ status: 'done', cancelledSignups: 1, mode: 'contractor' });
		expect(one(`select status, quoted_cents from contractor_job`)).toEqual({
			status: 'asked',
			quoted_cents: 22000
		});
		expect(one(`select posted_at from work_order where id = 't'`)).toEqual({ posted_at: null });
		expect(one(`select status from volunteer_signup where id = 'su-a'`)).not.toEqual({
			status: 'confirmed'
		});
		expect(audits('work_order.assigned')).toEqual([
			{ id: 't', from: 'open', to: 'contractor', cancelledSignups: 1 }
		]);
	});
});

describe('duties and equipment', () => {
	it('adds duties at the end, and ticks only a duty that is the task’s own', async () => {
		task('t');
		task('other');
		insert('work_task', { id: 'x', work_order_id: 'other', label: 'x', sort_order: 0 });
		const first = await tasks.addDuty(PROJECT, 't', ' Sweep ');
		const second = await tasks.addDuty(PROJECT, 't', 'Mop');
		expect([first.label, first.sortOrder, second.sortOrder]).toEqual(['Sweep', 0, 1]);

		await tasks.setDutyDone(PROJECT, 't', first.id, true, STAFF);
		expect(one(`select done, done_by_user_id from work_task where id = ?`, first.id)).toEqual({
			done: 1,
			done_by_user_id: STAFF
		});
		await expect(tasks.setDutyDone(PROJECT, 't', 'x', true, STAFF)).rejects.toBeInstanceOf(
			tasks.TaskNotFoundError
		);
	});

	it('refuses a unit that does not exist and clears with null', async () => {
		task('t');
		await expect(tasks.setTaskEquipment(PROJECT, 't', 'nope')).rejects.toBeInstanceOf(
			tasks.TaskValidationError
		);
		await tasks.setTaskEquipment(PROJECT, 't', null);
		expect(one(`select asset_id from work_order where id = 't'`)).toEqual({ asset_id: null });
	});
});
