import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * Who may keep a committee's items (#1708, #2989), through the real guards
 * against a migrated SQLite: for each of the four owning committees, its
 * members may take, tick, resolve and hand on its own items and nobody else's;
 * a non-member and a signed-out caller may not; staff may. Taking, ticking and
 * resolving are the duty, so a seat needs no grant for them; handing an item
 * to another committee does. The owner is read off the work order.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: null }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		const call = (...a: unknown[]) => ({
			refresh: async () => {},
			then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
				Promise.resolve()
					.then(() => handler(...a))
					.then(ok, fail)
		});
		return Object.assign(call, { __: { type: 'query' } });
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } })
}));

const who = vi.hoisted(() => ({ userId: null as string | null, staff: false }));
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => {
			if (!who.userId) throw error(401, 'Not authenticated');
			return { id: who.userId };
		},
		can: async () => who.staff,
		userHasCapability: async () => who.staff,
		isElevated: async () => who.staff,
		requireCapability: vi.fn()
	};
});

const writes = vi.hoisted(() => ({
	takeTask: vi.fn(async () => ({})),
	markTaskDone: vi.fn(async () => ({})),
	setWorkTaskDone: vi.fn(async () => ({})),
	reassign: vi.fn(async () => undefined)
}));
vi.mock('#lib/server/volunteer/assignee-service.js', () => ({
	takeTask: writes.takeTask,
	markTaskDone: writes.markTaskDone
}));
vi.mock('#lib/server/volunteer/work-order-service.js', () => ({
	getWorkOrderById: async (id: string) => ({ id, title: id, volunteerRoleId: null })
}));
vi.mock('#lib/server/volunteer/duty-list-service.js', () => ({
	setWorkTaskDone: writes.setWorkTaskDone,
	assertOwningCommittee: async (id: string | null) => id
}));
vi.mock('#lib/server/volunteer/deliverables-service.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/volunteer/deliverables-service.js')>()),
	reassignDeliverable: writes.reassign
}));
vi.mock('./events.remote', () => ({
	getStaffEventProduction: () => ({ refresh: async () => {} })
}));

const remote = (await import('./deliverables.remote')) as unknown as Record<
	string,
	(arg: unknown) => Promise<unknown>
>;

const COMMITTEES = ['book', 'prod', 'comms', 'art'] as const;
const exec = (sql: string) => sqlite.exec(sql);

beforeEach(() => {
	vi.clearAllMocks();
	who.userId = null;
	who.staff = false;
	for (const t of ['work_task', 'work_order', 'group_capability', 'group_member']) {
		exec(`delete from ${t}`);
	}
	exec(`delete from "group"`);
	exec(`insert or ignore into volunteer_role (id, name) values ('r', 'Any')`);
	exec(`insert into "group" (id, name, slug, kind) values
		('book', 'Booking', 'booking-committee', 'committee'),
		('prod', 'Production', 'production-committee', 'committee'),
		('comms', 'Communications', 'communications-committee', 'committee'),
		('art', 'Art', 'art-and-merchandise-committee', 'committee'),
		('fac', 'Facilities', 'facilities-committee', 'committee')`);
	for (const g of [...COMMITTEES, 'fac']) {
		exec(
			`insert or ignore into user (id, name, email, email_verified) values ('u-${g}', '${g}', '${g}@x.test', 1)`
		);
		exec(
			`insert into group_member (id, group_id, user_id, role, status) values ('m-${g}', '${g}', 'u-${g}', 'member', 'active')`
		);
		exec(
			`insert into work_order (id, volunteer_role_id, group_id) values ('wo-${g}', 'r', '${g}')`
		);
		exec(`insert into work_task (id, work_order_id, label) values ('t-${g}', 'wo-${g}', 'x')`);
	}
	for (const g of COMMITTEES) {
		exec(
			`insert into group_capability (group_id, capability) values ('${g}', 'volunteer.manageShifts')`
		);
	}
	exec(
		`insert or ignore into user (id, name, email, email_verified) values ('u-none', 'none', 'none@x.test', 1)`
	);
});

const ACTIONS: Record<string, (g: string) => [string, unknown]> = {
	take: (g) => ['takeDeliverable', { id: `wo-${g}` }],
	resolve: (g) => ['resolveDeliverable', { id: `wo-${g}` }],
	tick: (g) => ['tickDeliverableTask', { taskId: `t-${g}`, done: true }],
	handOn: (g) => ['reassignDeliverableForm', { id: `wo-${g}`, groupId: 'fac' }]
};
const run = (action: string, g: string) => {
	const [name, input] = ACTIONS[action](g);
	return remote[name](input);
};
const wrote = () =>
	writes.takeTask.mock.calls.length +
	writes.markTaskDone.mock.calls.length +
	writes.setWorkTaskDone.mock.calls.length +
	writes.reassign.mock.calls.length;

describe.each(Object.keys(ACTIONS))('%s', (action) => {
	describe.each(COMMITTEES)('an item %s owns', (owner) => {
		it('is allowed to its own members', async () => {
			who.userId = `u-${owner}`;
			await expect(run(action, owner)).resolves.toEqual({ success: true });
			expect(wrote()).toBe(1);
		});

		it('is refused to every other committee’s members, and writes nothing', async () => {
			for (const other of [...COMMITTEES, 'fac'].filter((g) => g !== owner)) {
				who.userId = `u-${other}`;
				await expect(run(action, owner)).rejects.toMatchObject({ status: 403 });
			}
			expect(wrote()).toBe(0);
		});

		it('is refused to a non-member and a signed-out caller', async () => {
			who.userId = 'u-none';
			await expect(run(action, owner)).rejects.toMatchObject({ status: 403 });
			who.userId = null;
			await expect(run(action, owner)).rejects.toMatchObject({ status: 401 });
			expect(wrote()).toBe(0);
		});

		it('is allowed to staff', async () => {
			who.userId = 'u-none';
			who.staff = true;
			await expect(run(action, owner)).resolves.toEqual({ success: true });
		});
	});

	// #2983 case 1: a seat was listed its committee's items and refused them.
	const duty = action !== 'handOn';
	it(`is ${duty ? 'allowed' : 'refused'} to a seat on a committee without the grant`, async () => {
		who.userId = 'u-fac';
		const result = run(action, 'fac');
		if (duty) await expect(result).resolves.toEqual({ success: true });
		else await expect(result).rejects.toMatchObject({ status: 403 });
		expect(wrote()).toBe(duty ? 1 : 0);
	});
});

describe('the owner comes from the row', () => {
	it('ignores a slug or event in the request', async () => {
		who.userId = 'u-comms';
		await expect(
			remote.resolveDeliverable({ id: 'wo-book', slug: 'communications-committee' })
		).rejects.toMatchObject({ status: 403 });
		expect(wrote()).toBe(0);
	});

	it('answers 404 for an item that does not exist, before any guard', async () => {
		who.userId = 'u-none';
		await expect(remote.resolveDeliverable({ id: 'nope' })).rejects.toMatchObject({
			status: 404
		});
	});
});
