import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A grant application is a project (#2622). Against a real SQLite with every
 * migration replayed, so the stage templates are the ones production has: the
 * project, its owner, the stamped tasks and their dates are all rows a mocked
 * `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	grantDeadline,
	grantDeadlineItems,
	grantStageOffers,
	createGrant,
	updateGrant,
	deleteGrant,
	getGrant,
	applyGrantStage
} = await import('./grant-service');
const { FundedProjectError } = await import('#lib/server/development/funding-project.js');
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

describe('grantStageOffers', () => {
	const none = new Set<never>();

	it('offers the award tasks once awarded, and the close-out from a month before the end', () => {
		const awarded = { status: 'awarded' as const, endsOn: '2027-06-30' };
		expect(grantStageOffers(awarded, none, TODAY)).toEqual(['award']);
		expect(grantStageOffers({ ...awarded, endsOn: '2026-10-20' }, none, TODAY)).toEqual([
			'award',
			'close_out'
		]);
	});

	it('offers nothing already on the project, and nothing before an award', () => {
		const ending = { status: 'awarded' as const, endsOn: '2026-10-01' };
		expect(grantStageOffers(ending, new Set(['award', 'close_out'] as const), TODAY)).toEqual([]);
		expect(grantStageOffers({ status: 'applied', endsOn: '2026-10-01' }, none, TODAY)).toEqual([]);
	});
});

describe('the grant page', () => {
	it('names the earliest open task as the next step', async () => {
		const grant = await createGrant(input({ applyBy: '2026-12-01' }));
		const { nextTask } = await getGrant(grant.id, TODAY);
		expect(nextTask?.title).toBe(tasks(grant.projectId!)[0].title);

		sqlite.exec(`update work_order set resolved_at = 1 where project_id = '${grant.projectId}'`);
		expect((await getGrant(grant.id, TODAY)).nextTask).toBeNull();
	});

	it('offers the award tasks until they are applied, then stops', async () => {
		const grant = await createGrant(input({ status: 'awarded', startsOn: '2026-10-01' }));
		expect((await getGrant(grant.id, TODAY)).offers).toEqual(['award']);

		sqlite.exec(
			`insert or ignore into user (id, name, email, email_verified) values ('staff-1', 'Staff', 's@x.test', 1)`
		);
		await applyGrantStage(grant.id, 'award', 'staff-1');
		expect((await getGrant(grant.id, TODAY)).offers).toEqual([]);
		expect(tasks(grant.projectId!).some((t) => t.section === 'Award')).toBe(true);
	});

	it('does not offer a stage whose template is switched off', async () => {
		sqlite.exec(`update duty_list set is_active = 0 where grant_stage = 'award'`);
		const grant = await createGrant(input({ status: 'awarded' }));
		expect((await getGrant(grant.id, TODAY)).offers).toEqual([]);
	});
});

describe('the funded project', () => {
	it('refuses a grant or sponsorship project as what the money pays for', async () => {
		const other = await createGrant(input({ title: 'Other' }));
		await expect(createGrant(input({ fundsProjectId: other.projectId }))).rejects.toBeInstanceOf(
			FundedProjectError
		);
	});

	it('takes an ordinary project', async () => {
		sqlite.exec(`insert into project (id, name) values ('fair', 'Repair fair 2027')`);
		const grant = await createGrant(input({ fundsProjectId: 'fair' }));
		expect(grant.fundsProjectId).toBe('fair');
	});
});
