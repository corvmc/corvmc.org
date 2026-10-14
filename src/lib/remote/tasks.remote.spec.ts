import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * Both ids a task remote takes come from the client, so each one that names a
 * work order must refuse (404) a work order on a different project, before it
 * touches anything: otherwise a project the caller manages is a window onto
 * work in one they do not. Real services, real SQLite; only the guard is faked.
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

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'usr-staff' }),
	can: async () => true,
	requireCapability: async () => ({ id: 'usr-staff' })
}));
const requireProjectCommittee = vi.hoisted(() =>
	vi.fn(async () => ({ user: { id: 'usr-staff' }, groups: [], via: 'staff' }))
);
vi.mock('$lib/server/group/group-context', () => ({ requireProjectCommittee }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const remotes = (await import('./tasks.remote')) as unknown as Record<
	string,
	(raw: unknown) => Promise<unknown>
>;

const MINE = '00000000-0000-4000-8000-000000000001';
const THEIRS = '00000000-0000-4000-8000-000000000002';
const pair = { projectId: MINE, workOrderId: 'wo-theirs' };

beforeEach(() => {
	requireProjectCommittee.mockClear();
	sqlite.exec('delete from volunteer_signup');
	sqlite.exec('delete from work_order');
	sqlite.exec('delete from volunteer_role');
	sqlite.exec('delete from project');
	sqlite.exec(`insert into project (id, name) values ('${MINE}', 'Mine'), ('${THEIRS}', 'Theirs')`);
	sqlite.exec(`insert into volunteer_role (id, name, is_active) values ('role-1', 'Door', 1)`);
	sqlite.exec(
		`insert into work_order (id, project_id, title, volunteer_role_id, capacity)
			values ('wo-theirs', '${THEIRS}', 'Theirs', 'role-1', 1)`
	);
});

const untouched = () =>
	sqlite
		.prepare(
			`select project_id, posted_at, resolved_at, cancelled_at, section_id, sort_order, starts_at
				from work_order where id = 'wo-theirs'`
		)
		.get();

const cases: [string, Record<string, unknown>][] = [
	['getTaskAssignees', pair],
	['moveTaskCommand', { ...pair, sectionId: null, index: 0 }],
	['assignMembersForm', { ...pair, userIds: ['usr-staff'] }],
	['unassignMemberForm', { ...pair, userId: 'usr-staff' }],
	['openTaskForm', { ...pair, capacity: 2 }],
	['unassignTaskForm', { ...pair, confirm: true }],
	['resolveTaskForm', pair],
	['reopenTaskForm', pair],
	['rescheduleTaskForm', { ...pair, startsAt: '2030-01-01T18:00', endsAt: '2030-01-01T20:00' }],
	['cancelTaskForm', pair]
];

describe('a work order named with a project it is not on', () => {
	const before = { project_id: THEIRS, posted_at: null, resolved_at: null, cancelled_at: null };

	it.each(cases)('%s refuses it with a 404 and changes nothing', async (name, input) => {
		await expect(remotes[name](input)).rejects.toMatchObject({ status: 404 });
		expect(untouched()).toMatchObject(before);
	});

	it('is still reachable through its own project', async () => {
		await remotes.openTaskForm({ projectId: THEIRS, workOrderId: 'wo-theirs', capacity: 2 });
		expect(untouched()).toMatchObject({ project_id: THEIRS, posted_at: expect.any(Number) });
	});
});

describe('the guard', () => {
	it('runs on the project named, before the task is loaded', async () => {
		requireProjectCommittee.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }));
		await expect(
			remotes.cancelTaskForm({ projectId: THEIRS, workOrderId: 'wo-theirs' })
		).rejects.toMatchObject({
			status: 403
		});
		expect(requireProjectCommittee).toHaveBeenCalledWith(THEIRS, 'project.manage');
		expect(untouched()).toMatchObject({ cancelled_at: null });
	});
});
