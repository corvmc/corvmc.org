import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * A committee's `'owned'` `volunteer.manageShifts` grant reaches the tasks it
 * owns and the tasks of projects it takes part in, and no others (#2984). Real
 * guard, real resolver, real SQLite; only the request is faked.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));

const req = vi.hoisted(() => ({ locals: {} as Record<string, unknown> }));
vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: req.locals, url: new URL('http://x/') }),
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
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { updateShift, updateTask, confirmSignups } =
	(await import('./volunteer.remote')) as unknown as Record<
		string,
		(raw: unknown) => Promise<unknown>
	>;

const as = (id: string) => (req.locals = { user: { id } });
const notes = (shiftId: string) =>
	sqlite.prepare(`select notes from volunteer_shift where id = ?`).get(shiftId);

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'project_committee',
		'project',
		'volunteer_role',
		'group_capability',
		'group_member',
		'"group"',
		'model_has_roles',
		'roles',
		'user'
	])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec(`insert into user (id, name, email) values
		('u-seat', 'Seat', 'seat@example.com'), ('u-admin', 'Admin', 'admin@example.com'),
		('u-vol', 'Vol', 'vol@example.com')`);
	sqlite.exec(`insert into roles (id, name) values (1, 'admin')`);
	sqlite.exec(`insert into model_has_roles (role_id, user_id) values (1, 'u-admin')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
		('g-mine', 'committee', 'Mine', 'mine'), ('g-other', 'committee', 'Other', 'other')`);
	sqlite.exec(`insert into group_member (id, group_id, user_id, role, status)
		values ('m1', 'g-mine', 'u-seat', 'member', 'active')`);
	sqlite.exec(`insert into group_capability (group_id, capability) values
		('g-mine', 'volunteer.manageShifts'), ('g-other', 'volunteer.manageShifts')`);
	sqlite.exec(`insert into project (id, name) values ('p-mine', 'Mine'), ('p-other', 'Other')`);
	sqlite.exec(
		`insert into project_committee (project_id, group_id, role) values ('p-mine', 'g-mine', 'owner')`
	);
	sqlite.exec(`insert into volunteer_role (id, name, is_active) values ('role', 'Door', 1)`);
	sqlite.exec(`insert into work_order (id, volunteer_role_id, group_id, project_id) values
		('wo-mine', 'role', 'g-mine', null), ('wo-other', 'role', 'g-other', null),
		('wo-proj', 'role', null, 'p-mine'), ('wo-elsewhere', 'role', null, 'p-other')`);
	for (const wo of ['wo-mine', 'wo-other', 'wo-proj', 'wo-elsewhere'])
		sqlite.exec(`insert into volunteer_shift (id, work_order_id, starts_at, ends_at)
			values ('s-${wo.slice(3)}', '${wo}', 1900000000, 1900003600)`);
});

describe("a committee's owned grant", () => {
	it("passes on its own committee's task and on its project's", async () => {
		as('u-seat');
		await updateShift({ shiftId: 's-mine', notes: 'Bring keys' });
		await updateShift({ shiftId: 's-proj', notes: 'Bring tape' });
		expect([notes('s-mine'), notes('s-proj')]).toEqual([
			{ notes: 'Bring keys' },
			{ notes: 'Bring tape' }
		]);
	});

	it("is refused on another committee's task and another project's, and writes nothing", async () => {
		as('u-seat');
		await expect(updateShift({ shiftId: 's-other', notes: 'x' })).rejects.toMatchObject({
			status: 403
		});
		await expect(updateTask({ id: 'wo-elsewhere', title: 'Renamed' })).rejects.toMatchObject({
			status: 403
		});
		expect(notes('s-other')).toEqual({ notes: null });
	});

	it('leaves a non-member refused and an org-wide holder passing', async () => {
		as('u-vol');
		await expect(updateShift({ shiftId: 's-mine', notes: 'x' })).rejects.toMatchObject({
			status: 403
		});
		as('u-admin');
		await updateShift({ shiftId: 's-other', notes: 'Admin note' });
		expect(notes('s-other')).toEqual({ notes: 'Admin note' });
	});
});

describe('confirming several signups', () => {
	it('confirms only the ones on the shift it names', async () => {
		as('u-admin');
		sqlite.exec(`insert into volunteer_signup (id, shift_id, user_id, status) values
			('su-here', 's-mine', 'u-vol', 'claimed'), ('su-there', 's-other', 'u-vol', 'claimed')`);
		await confirmSignups({ shiftId: 's-mine', signupIds: ['su-here', 'su-there'] });
		expect(sqlite.prepare(`select id, status from volunteer_signup order by id`).all()).toEqual([
			{ id: 'su-here', status: 'confirmed' },
			{ id: 'su-there', status: 'claimed' }
		]);
	});
});
