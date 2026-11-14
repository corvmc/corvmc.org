import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A project's task list, against a real SQLite: ordering, sections, the
 * assignment switches and derived completion are all writes and `WHERE`s that
 * a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('outside a request');
	}
}));
vi.mock('#lib/server/volunteer/volunteer-profile-service.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	requireActiveVolunteer: vi.fn(async () => undefined)
}));
const emit = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => undefined));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit } }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/volunteer/member-certification-service.js', () => ({
	missingRequirements: vi.fn(async () => [])
}));

const tasks = await import('./project-task-service');
const sections = await import('./project-section-service');
const { applyDutyList } = await import('#lib/server/volunteer/duty-list-service.js');

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
		'volunteer_shift',
		'work_order_assignee',
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
	insert('work_order', { id, project_id: PROJECT, title: id, ...cols });

/** A shift on a task, still to come unless `cols` says otherwise. */
const FUTURE = 4_000_000_000;
const shift = (id: string, workOrderId: string, cols: Record<string, unknown> = {}) =>
	insert('volunteer_shift', {
		id,
		work_order_id: workOrderId,
		starts_at: FUTURE,
		ends_at: FUTURE + 3600,
		capacity: 1,
		...cols
	});

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
		expect(row).toMatchObject({ volunteerRoleId: null, sortOrder: 1 });
		expect(order(s.id)).toEqual(['first', row.id]);
		expect(audits('work_order.created')).toEqual([
			{ id: row.id, projectId: PROJECT, title: 'Buy paint' }
		]);
	});

	it("gives a grant's or sponsorship's task its owning committee, and nobody else's", async () => {
		const plain = await tasks.createTask({
			projectId: PROJECT,
			title: 'x',
			createdByUserId: STAFF
		});
		expect(plain.groupId).toBeNull();
		for (const kind of ['grant', 'sponsorship']) {
			sqlite.exec(`update project set kind = '${kind}' where id = '${PROJECT}'`);
			const row = await tasks.createTask({
				projectId: PROJECT,
				title: 'Interim report',
				createdByUserId: STAFF
			});
			expect(row.groupId).toBe(COMMITTEE);
		}
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

describe('rescheduling', () => {
	it('moves the deadline and leaves its shifts alone', async () => {
		task('t', { volunteer_role_id: ROLE });
		shift('s', 't');

		const due = new Date(1_950_000_000_000);
		await tasks.rescheduleTask(PROJECT, 't', { dueAt: due });

		expect(one(`select due_at from work_order where id = 't'`)).toEqual({ due_at: 1_950_000_000 });
		expect(all(`select id from volunteer_shift where cancelled_at is null`)).toHaveLength(1);
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
