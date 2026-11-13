import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * New task writes to a project only as that project's committee or staff, and a
 * task's history refuses (404) a task named with a project it is not on.
 * Real services, real SQLite; only the guard is faked.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: () => 0
}));

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-staff' } }, url: new URL('http://x/') }),
		query: (_schema: unknown, handler: (...a: unknown[]) => unknown) =>
			mark(
				(raw: unknown) => ({
					refresh: async () => {},
					then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
						Promise.resolve()
							.then(() => handler(raw))
							.then(ok, fail)
				}),
				'query'
			),
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});

vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<object>()),
	requireUser: () => ({ id: 'usr-staff' }),
	can: async () => true,
	requireCapability: async () => ({ id: 'usr-staff' })
}));
const requireProjectCommittee = vi.hoisted(() =>
	vi.fn(async () => ({ user: { id: 'usr-staff' }, groups: [], via: 'staff' }))
);
vi.mock('#lib/server/group/group-context.js', () => ({ requireProjectCommittee }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const remotes = (await import('./tasks.remote')) as unknown as Record<
	string,
	(raw: unknown) => Promise<unknown>
>;

const { getProjectActivity } = (await import('./projects.remote')) as unknown as Record<
	string,
	(raw: unknown) => Promise<unknown>
>;

const { setTaskSection } = (await import('./volunteer.remote')) as unknown as Record<
	string,
	(raw: unknown) => Promise<unknown>
>;

const MINE = '00000000-0000-4000-8000-000000000001';
const THEIRS = '00000000-0000-4000-8000-000000000002';
const pair = { projectId: MINE, workOrderId: 'wo-theirs' };

beforeEach(() => {
	requireProjectCommittee.mockClear();
	sqlite.exec('delete from volunteer_signup');
	sqlite.exec('delete from volunteer_shift');
	sqlite.exec('delete from work_order');
	sqlite.exec('delete from project_section');
	sqlite.exec('delete from volunteer_role');
	sqlite.exec('delete from project');
	sqlite.exec(`insert into project (id, name) values ('${MINE}', 'Mine'), ('${THEIRS}', 'Theirs')`);
	sqlite.exec(`insert into volunteer_role (id, name, is_active) values ('role-1', 'Door', 1)`);
	sqlite.exec(
		`insert into work_order (id, project_id, title, volunteer_role_id, sort_order)
			values ('wo-theirs', '${THEIRS}', 'Theirs', 'role-1', 5),
				('wo-first', '${THEIRS}', 'First', 'role-1', 0)`
	);
});

describe('New task', () => {
	it("in a project, is that project's write and keeps its due date", async () => {
		const { id } = (await remotes.createCatalogueTaskForm({
			title: 'Paint the hall',
			projectId: THEIRS,
			dueAt: '2030-01-04'
		})) as { id: string };
		expect(requireProjectCommittee).toHaveBeenCalledWith(THEIRS, 'project.manage');
		expect(
			sqlite
				.prepare(`select project_id, title, due_at is not null as due from work_order where id = ?`)
				.get(id)
		).toEqual({ project_id: THEIRS, title: 'Paint the hall', due: 1 });
	});

	it('in no project, asks no committee', async () => {
		const { id } = (await remotes.createCatalogueTaskForm({ title: 'Fix the amp' })) as {
			id: string;
		};
		expect(requireProjectCommittee).not.toHaveBeenCalled();
		expect(sqlite.prepare(`select project_id from work_order where id = ?`).get(id)).toEqual({
			project_id: null
		});
	});

	it('links the task to the record it was made from (#2622)', async () => {
		sqlite.exec(`insert into organization (id, name) values ('org-arts', 'Arts Council')`);
		const { id } = (await remotes.createCatalogueTaskForm({
			title: 'Call about the spring cycle',
			aboutType: 'organization',
			aboutId: 'org-arts'
		})) as { id: string };
		expect(
			sqlite.prepare(`select organization_id from work_order_link where work_order_id = ?`).all(id)
		).toEqual([{ organization_id: 'org-arts' }]);
		sqlite.exec(`delete from work_order_link; delete from organization`);
	});

	it('refuses a project the caller does not manage, and writes nothing', async () => {
		requireProjectCommittee.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }));
		await expect(
			remotes.createCatalogueTaskForm({ title: 'Sneak in', projectId: MINE })
		).rejects.toMatchObject({ status: 403 });
		expect(
			sqlite.prepare(`select count(*) n from work_order where project_id = ?`).get(MINE)
		).toEqual({ n: 0 });
	});
});

describe('the activity', () => {
	it('refuses a task named with a project it is not on', async () => {
		await expect(getProjectActivity(pair)).rejects.toMatchObject({ status: 404 });
	});

	it("reads a task's history under its own project, and the project's", async () => {
		sqlite.exec(
			`insert into audit_log (id, action, actor_name, actor_email, subject_type, subject_id, details)
				values ('a-1', 'work_order.reopened', 'Sam', 's@x', 'work_order', 'wo-theirs', '{}')`
		);
		const task = { projectId: THEIRS, workOrderId: 'wo-theirs' };
		await expect(getProjectActivity(task)).resolves.toMatchObject({
			items: [{ summary: 'Reopened it', task: { id: 'wo-theirs' } }]
		});
		await expect(getProjectActivity({ projectId: THEIRS })).resolves.toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({ summary: 'Reopened it' })])
		});
		sqlite.exec(`delete from audit_log`);
	});
});

describe('sections (#2653)', () => {
	const sectionsOf = (projectId: string) =>
		sqlite
			.prepare(`select id, name from project_section where project_id = ? order by sort_order`)
			.all(projectId) as { id: string; name: string }[];

	beforeEach(() => {
		sqlite.exec(
			`insert into project_section (id, project_id, name, sort_order)
				values ('sec-prep', '${THEIRS}', 'Prep', 0), ('sec-strike', '${THEIRS}', 'Strike', 1),
					('sec-mine', '${MINE}', 'Mine', 0)`
		);
	});

	it("are the project's to add, rename, reorder and delete, as its committee's write", async () => {
		await remotes.createSectionForm({ projectId: THEIRS, name: 'Load-in' });
		await remotes.renameSectionForm({ projectId: THEIRS, sectionId: 'sec-prep', name: 'Setup' });
		const ids = sectionsOf(THEIRS).map((s) => s.id);
		await remotes.reorderSectionsCommand({ projectId: THEIRS, sectionIds: [...ids].reverse() });
		expect(sectionsOf(THEIRS).map((s) => s.name)).toEqual(['Load-in', 'Strike', 'Setup']);

		sqlite.exec(`update work_order set section_id = 'sec-strike' where id = 'wo-first'`);
		await expect(
			remotes.deleteSectionForm({ projectId: THEIRS, sectionId: 'sec-strike' })
		).resolves.toEqual({ moved: 1 });
		expect(sqlite.prepare(`select section_id from work_order where id = 'wo-first'`).get()).toEqual(
			{ section_id: null }
		);
		expect(requireProjectCommittee).toHaveBeenCalledWith(THEIRS, 'project.manage');
		expect(requireProjectCommittee).not.toHaveBeenCalledWith(MINE, expect.anything());
	});

	it('refuses a section named with a project it is not on', async () => {
		await expect(
			remotes.renameSectionForm({ projectId: THEIRS, sectionId: 'sec-mine', name: 'Taken' })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			remotes.createCatalogueTaskForm({ title: 'Wire', projectId: THEIRS, sectionId: 'sec-mine' })
		).rejects.toMatchObject({ status: 404 });
		expect(sectionsOf(MINE)).toEqual([{ id: 'sec-mine', name: 'Mine' }]);
	});

	it('puts a new task in the section it names', async () => {
		const { id } = (await remotes.createCatalogueTaskForm({
			title: 'Sweep',
			projectId: THEIRS,
			sectionId: 'sec-strike'
		})) as { id: string };
		expect(sqlite.prepare(`select section_id from work_order where id = ?`).get(id)).toEqual({
			section_id: 'sec-strike'
		});
	});

	it("reads one project's sections in order with its tasks, and none across projects", async () => {
		sqlite.exec(`update project_section set sort_order = 5 where id = 'sec-prep'`);
		sqlite.exec(`update work_order set section_id = 'sec-prep' where id = 'wo-first'`);
		const page = (await remotes.getTasksPage({ projectId: THEIRS })) as {
			sections: { id: string }[];
			tasks: { id: string; sectionId: string | null }[];
		};
		expect(page.sections.map((s) => s.id)).toEqual(['sec-strike', 'sec-prep']);
		expect(page.tasks.find((t) => t.id === 'wo-first')?.sectionId).toBe('sec-prep');
		const all = (await remotes.getTasksPage({})) as { sections: unknown[] };
		expect(all.sections).toEqual([]);
	});

	it("moves a task to a section of its own project, or to none, from the task's page", async () => {
		const sectionOf = () =>
			sqlite.prepare(`select section_id from work_order where id = 'wo-theirs'`).get();

		await setTaskSection({ id: 'wo-theirs', sectionId: 'sec-prep' });
		expect(sectionOf()).toEqual({ section_id: 'sec-prep' });
		expect(requireProjectCommittee).toHaveBeenCalledWith(THEIRS, 'project.manage');

		await expect(setTaskSection({ id: 'wo-theirs', sectionId: 'sec-mine' })).rejects.toMatchObject({
			status: 404
		});
		expect(sectionOf()).toEqual({ section_id: 'sec-prep' });

		await setTaskSection({ id: 'wo-theirs', sectionId: '' });
		expect(sectionOf()).toEqual({ section_id: null });
	});
});
