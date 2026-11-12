import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A grant application is a project (#2622). Against a real SQLite with every
 * migration replayed, so the stage templates are the ones production has: the
 * project, its owner, the stamped tasks and their dates are all rows a mocked
 * `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { grantDeadline, grantDeadlineItems, withDeadlines, createGrant, updateGrant, deleteGrant } =
	await import('./grant-service');
const { grantDayAt } = await import('#lib/server/volunteer/duty-list-service.js');
const { grantStages } = await import('#lib/config.js');

const TODAY = '2026-09-23';
const base = { status: 'prospect' as const, applyBy: null, endsOn: null };

const all = <T>(query: string, ...args: unknown[]) => sqlite.prepare(query).all(...args) as T[];
const one = <T>(query: string, ...args: unknown[]) => sqlite.prepare(query).get(...args) as T;

beforeEach(() => {
	for (const t of [
		'audit_log',
		'work_task',
		'work_order',
		'project_section',
		'project_committee',
		'grant_application',
		'project',
		'party_role',
		'organization',
		'group_capability',
		'"group"'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`update duty_list set is_active = 1 where grant_stage is not null`);
	sqlite.exec(`insert into organization (id, name) values ('oac', 'Oregon Arts Commission')`);
	sqlite.exec(`insert into party_role (id, organization_id, role) values ('r1', 'oac', 'funder')`);
});

function committees() {
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('dev', 'Development Committee', 'development-committee', 'committee'),
			('board', 'Board', 'board', 'committee'),
			('band', 'A Band', 'a-band', 'band')`
	);
	sqlite.exec(
		`insert into group_capability (group_id, capability) values
			('board', 'grant.manage'), ('dev', 'grant.manage'), ('band', 'grant.manage')`
	);
}

const input = (over: Record<string, unknown> = {}) => ({
	organizationId: 'oac',
	title: 'Operating support',
	status: 'prospect' as const,
	...over
});

type Task = { title: string; due_at: number | null; pending: number | null; section: string };
const tasks = (projectId: string) =>
	all<Task>(
		`select wo.title, wo.due_at, wo.pending_offset_minutes pending, s.name section
		 from work_order wo join project_section s on s.id = wo.section_id
		 where wo.project_id = ? order by wo.sort_order`,
		projectId
	);

describe('grantDeadline', () => {
	it('is the apply-by date for a prospect and the award end once awarded', () => {
		expect(grantDeadline({ ...base, applyBy: '2026-10-01' }, TODAY)).toEqual({
			kind: 'apply',
			on: '2026-10-01',
			overdue: false
		});
		expect(
			grantDeadline({ ...base, status: 'awarded', endsOn: '2026-09-01' }, TODAY)
		).toMatchObject({ kind: 'end', overdue: true });
	});

	it('has none while applied, declined or closed', () => {
		for (const status of ['applied', 'declined', 'closed'] as const) {
			expect(grantDeadline({ status, applyBy: '2026-10-01', endsOn: '2027-01-01' }, TODAY)).toBe(
				null
			);
		}
	});

	it('names each deadline as its own reminder subject', () => {
		expect(grantDeadlineItems({ ...base, id: 'g1', applyBy: '2026-11-01' })).toEqual([
			{ kind: 'apply', on: '2026-11-01', subjectId: 'apply:g1', title: 'Apply by' }
		]);
	});

	it('sorts applications by deadline, undated last', () => {
		const app = (id: string, over: Record<string, unknown>) => ({
			id,
			funderName: id,
			...base,
			...over
		});
		const rows = withDeadlines(
			[app('undated', { status: 'applied' }), app('later', { applyBy: '2026-12-01' })],
			TODAY
		);
		expect(rows.map((r) => r.id)).toEqual(['later', 'undated']);
	});
});

describe('the stage templates', () => {
	it('exist for every stage, each with tasks, from the migration alone', () => {
		const rows = all<{ grant_stage: string; items: number; project_kind: string }>(
			`select d.grant_stage, d.project_kind, count(i.id) items
			 from duty_list d join duty_list_item i on i.duty_list_id = d.id
			 where d.grant_stage is not null group by d.id`
		);
		expect(rows.map((r) => r.grant_stage).sort()).toEqual([...grantStages].sort());
		expect(rows.every((r) => r.items > 0 && r.project_kind === 'grant')).toBe(true);
	});

	it('carry help text on every task', () => {
		const bare = one<{ n: number }>(
			`select count(*) n from duty_list_item i join duty_list d on d.id = i.duty_list_id
			 where d.grant_stage is not null and (i.notes is null or i.notes = '')`
		);
		expect(bare.n).toBe(0);
	});
});

describe('createGrant', () => {
	it('opens a grant project owned by the Development committee', async () => {
		committees();
		const grant = await createGrant(input({ applyBy: '2026-12-01' }), { createdByUserId: null });

		const project = one<{ kind: string; name: string }>(
			`select kind, name from project where id = ?`,
			grant.projectId
		);
		expect(project).toEqual({ kind: 'grant', name: 'Operating support' });
		expect(
			all(`select group_id, role from project_committee where project_id = ?`, grant.projectId)
		).toEqual([{ group_id: 'dev', role: 'owner' }]);
	});

	it('stamps the application template, timed back from the apply-by date', async () => {
		const grant = await createGrant(input({ applyBy: '2026-12-01' }));
		const stamped = tasks(grant.projectId!);

		expect(stamped.length).toBeGreaterThan(0);
		expect(stamped.every((t) => t.section === 'Application' && t.pending === null)).toBe(true);
		const deadline = grantDayAt('2026-12-01').getTime() / 1000;
		const last = stamped[stamped.length - 1];
		expect(last.due_at).toBe(deadline - 86_400);
		expect(stamped.every((t) => t.due_at! <= deadline)).toBe(true);
	});

	it('leaves the project unowned when no committee holds grant.manage', async () => {
		const grant = await createGrant(input());
		expect(
			one<{ n: number }>(
				`select count(*) n from project_committee where project_id = ?`,
				grant.projectId
			).n
		).toBe(0);
	});

	it('stamps nothing when staff have switched the template off', async () => {
		sqlite.exec(`update duty_list set is_active = 0 where grant_stage = 'application'`);
		const grant = await createGrant(input({ applyBy: '2026-12-01' }));
		expect(tasks(grant.projectId!)).toEqual([]);
	});
});

describe('updateGrant', () => {
	it('places tasks waiting on the apply-by date and renames the project', async () => {
		const grant = await createGrant(input());
		expect(tasks(grant.projectId!).every((t) => t.due_at === null && t.pending !== null)).toBe(
			true
		);

		await updateGrant(grant.id, input({ title: 'Spring cycle', applyBy: '2026-12-01' }));

		const placed = tasks(grant.projectId!);
		expect(placed.every((t) => t.due_at !== null && t.pending === null)).toBe(true);
		expect(one(`select name from project where id = ?`, grant.projectId)).toEqual({
			name: 'Spring cycle'
		});
	});
});

describe('deleteGrant', () => {
	it('takes the project and its tasks with it', async () => {
		const grant = await createGrant(input({ applyBy: '2026-12-01' }));
		await deleteGrant(grant.id);
		expect(one<{ n: number }>(`select count(*) n from project`).n).toBe(0);
		expect(one<{ n: number }>(`select count(*) n from work_order`).n).toBe(0);
		expect(one<{ n: number }>(`select count(*) n from grant_application`).n).toBe(0);
	});
});
