import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * #2387: a show starts from the Production template, picked on New Project, and
 * every other way of opening a show stamps the same one. Against a real SQLite
 * replayed from the migrations, which carry the `Show deliverables` template.
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
	})
}));
const capture = vi.fn();
vi.mock('$lib/server/sentry', () => ({ captureException: capture }));

const { stampProductionTemplate } = await import('./production-project');
const { startProject, attachToProject, listProjects } =
	await import('$lib/server/project/project-service');
const onProjectsView = async () =>
	(await listProjects({ exceptListedShows: true })).map((p) => p.id);

const T0 = 1_790_000_000;
const exec = (sql: string) => sqlite.exec(sql);
const get = <T>(sql: string) => sqlite.prepare(sql).get() as T;
const all = <T>(sql: string) => sqlite.prepare(sql).all() as T[];

const template = () =>
	get<{ id: string }>(`select id from duty_list where project_kind = 'production'`).id;

beforeEach(() => {
	capture.mockClear();
	exec(`delete from audit_log`);
	exec(`delete from work_task`);
	exec(`delete from work_order`);
	exec(`delete from event_listing`);
	exec(`delete from production`);
	exec(`delete from project_committee`);
	exec(`delete from project_section`);
	exec(`delete from project`);
	exec(`update duty_list set is_active = 1`);
});

describe('the migration', () => {
	it('moves the deliverables off auto-apply, onto the Production template', () => {
		expect(
			get(`select name, auto_apply_on as trigger from duty_list where project_kind = 'production'`)
		).toEqual({ name: 'Show deliverables', trigger: null });
	});
});

describe('stampProductionTemplate', () => {
	beforeEach(() => {
		exec(`insert into project (id, name, kind) values ('proj', 'Friday', 'production')`);
		exec(`insert into production (id, project_id) values ('p', 'proj')`);
		exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, project_id)
			values ('evt', 'Friday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show', 'proj')`);
	});

	const stamped = () =>
		all<{ title: string; due: number; doneWhen: string }>(
			`select title, due_at - ${T0} as due, done_when as doneWhen from work_order
			 where event_id = 'evt' and cancelled_at is null order by due_at, title`
		);

	it('stamps the deliverables, due relative to the show’s start', async () => {
		await stampProductionTemplate('proj', 'evt', null);
		const rows = stamped();
		expect(rows).toHaveLength(9);
		expect(rows[0]).toMatchObject({ due: -28 * 86_400, doneWhen: 'production_confirmed' });
		expect(rows.at(-1)).toMatchObject({ due: 3 * 86_400, doneWhen: 'production_settled' });
		expect(get(`select count(*) as n from work_task`)).toEqual({ n: 8 });
	});

	it('changes nothing the second time', async () => {
		await stampProductionTemplate('proj', 'evt', null);
		await stampProductionTemplate('proj', 'evt', null);
		expect(stamped()).toHaveLength(9);
		expect(capture).not.toHaveBeenCalled();
	});

	it('does nothing while the template is archived', async () => {
		exec(`update duty_list set is_active = 0`);
		await stampProductionTemplate('proj', 'evt', null);
		expect(stamped()).toEqual([]);
	});

	it('lands the work in the show’s project, timed from this show', async () => {
		await stampProductionTemplate('proj', 'evt', null);
		expect(all(`select distinct project_id as p, event_id as e, anchor from work_order`)).toEqual([
			{ p: 'proj', e: 'evt', anchor: 'start' }
		]);
	});
});

describe('startProject', () => {
	const NAME = { name: 'Friday', createdByUserId: null };

	it('creates a plain project when no template is picked', async () => {
		const row = await startProject(NAME);
		expect(row.kind).toBe('general');
		expect(all(`select id from production`)).toEqual([]);
		expect(all(`select id from work_order`)).toEqual([]);
	});

	it('makes a show from the Production template, in one action', async () => {
		const row = await startProject(NAME, template());
		expect(row.kind).toBe('production');
		expect(get(`select project_id as p, status from production`)).toEqual({
			p: row.id,
			status: 'draft'
		});
		expect(all(`select id from work_order where project_id = '${row.id}'`)).toHaveLength(9);
		expect(
			get(`select count(*) as n from audit_log where action = 'project.duty_list_applied'`)
		).toEqual({ n: 1 });
	});

	it('keeps what the form said about a show', async () => {
		exec(
			`insert into "group" (id, name, slug, kind) values ('g1', 'Facilities', 'fac', 'committee')`
		);
		const row = await startProject(
			{ ...NAME, description: 'why', budgetCents: 500, groupId: 'g1' },
			template()
		);
		expect(row).toMatchObject({ description: 'why', budgetCents: 500 });
		expect(
			get(`select role from project_committee where project_id = '${row.id}' and group_id = 'g1'`)
		).toEqual({ role: 'owner' });
		exec(`delete from project_committee`);
		exec(`delete from "group" where id = 'g1'`);
	});

	it('applies any other template without making a show', async () => {
		exec(
			`insert into duty_list (id, name, anchor, subject) values ('plain', 'Plain', 'doors', 'project')`
		);
		const role = get<{ id: string }>(`select id from volunteer_role limit 1`).id;
		exec(`insert into duty_list_item (id, duty_list_id, volunteer_role_id, sort_order, due_offset_minutes)
			values ('plain-1', 'plain', '${role}', 0, -60)`);
		const row = await startProject(NAME, 'plain');
		expect(row.kind).toBe('general');
		expect(all(`select id from production`)).toEqual([]);
		expect(all(`select id from work_order where project_id = '${row.id}'`)).toHaveLength(1);
		exec(`delete from work_order`);
		exec(`delete from duty_list where id = 'plain'`);
	});

	it('writes nothing when the template cannot be started from', async () => {
		exec(`update duty_list set is_active = 0`);
		await expect(startProject(NAME, template())).rejects.toThrow();
		await expect(startProject(NAME, 'missing')).rejects.toThrow();
		expect(all(`select id from project`)).toEqual([]);
	});

	it('places event-timed work when the listing attaches', async () => {
		const row = await startProject(NAME, template());
		expect(all(`select id from work_order where due_at is not null`)).toEqual([]);

		exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind)
			values ('evt2', 'Friday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show')`);
		await attachToProject('event_listing', 'evt2', row.id);

		expect(all(`select id from work_order where due_at is not null`)).toHaveLength(9);
	});

	it('lists a show on Projects until a listing puts it on Productions', async () => {
		const row = await startProject(NAME, template());
		expect(await onProjectsView()).toEqual([row.id]);

		exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind)
			values ('evt3', 'Friday', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show')`);
		await attachToProject('event_listing', 'evt3', row.id);

		expect(await onProjectsView()).toEqual([]);
	});
});
