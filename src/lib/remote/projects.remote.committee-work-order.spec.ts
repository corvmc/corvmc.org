import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// The committee is read off the project row, never off the request: these pin
// what the guard is handed, and that nothing is written when it refuses.

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		// Lazy, like kit's: a query that is only refreshed never runs its handler here.
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

let signedIn = true;
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => {
			if (!signedIn) throw error(401, 'Not authenticated');
			return { id: 'user-1' };
		},
		requireCapability: vi.fn()
	};
});

const mocks = vi.hoisted(() => ({
	requireProjectCommittee: vi.fn(),
	getProjectById: vi.fn(),
	createWorkOrder: vi.fn(),
	refreshMemberGroup: vi.fn()
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireProjectCommittee: mocks.requireProjectCommittee
}));
vi.mock('$lib/server/project/project-service', () => ({ getProjectById: mocks.getProjectById }));
vi.mock('$lib/server/volunteer/work-order-service', () => ({
	createWorkOrder: mocks.createWorkOrder
}));
vi.mock('$lib/server/volunteer/duty-list-service', () => ({}));
vi.mock('$lib/remote/groups.remote', () => ({
	getMemberGroup: () => ({ refresh: mocks.refreshMemberGroup })
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { createCommitteeProjectWorkOrderForm: submit } =
	(await import('./projects.remote')) as unknown as Record<
		string,
		(arg: unknown) => Promise<unknown>
	>;

const PROJECT = '00000000-0000-4000-8000-000000000001';
const input = { projectId: PROJECT, volunteerRoleId: 'role-1', notes: 'Patch the wall' };

describe('createCommitteeProjectWorkOrderForm', () => {
	beforeEach(() => {
		signedIn = true;
		vi.clearAllMocks();
		mocks.getProjectById.mockResolvedValue({ id: PROJECT, groupId: 'committee-1' });
		mocks.createWorkOrder.mockResolvedValue({ id: 'wo-1' });
	});

	it('opens a work order on the project for a member of a committee taking part', async () => {
		mocks.requireProjectCommittee.mockResolvedValue({
			user: { id: 'user-1' },
			groups: [{ id: 'committee-1', slug: 'facilities' }],
			via: 'committee'
		});

		await expect(submit(input)).resolves.toEqual({ success: true });
		expect(mocks.requireProjectCommittee).toHaveBeenCalledWith(PROJECT, 'volunteer.manageShifts');
		expect(mocks.createWorkOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				volunteerRoleId: 'role-1',
				projectId: PROJECT,
				notes: 'Patch the wall',
				createdByUserId: 'user-1'
			})
		);
		expect(mocks.refreshMemberGroup).toHaveBeenCalled();
	});

	it('refuses someone outside the committee, and writes nothing', async () => {
		const { error } = await import('@sveltejs/kit');
		mocks.requireProjectCommittee.mockImplementation(async () => {
			throw error(403, 'Not a member of the committee that owns this');
		});

		await expect(submit(input)).rejects.toMatchObject({ status: 403 });
		expect(mocks.createWorkOrder).not.toHaveBeenCalled();
	});

	it('takes the committee from the project, not from a groupId in the request', async () => {
		const { error } = await import('@sveltejs/kit');
		mocks.requireProjectCommittee.mockImplementation(async (projectId: string) => {
			if (projectId !== 'my-committee') throw error(403, 'Not a member');
			return { user: { id: 'user-1' }, groups: [], via: 'committee' };
		});

		await expect(submit({ ...input, groupId: 'my-committee' })).rejects.toMatchObject({
			status: 403
		});
		expect(mocks.requireProjectCommittee).toHaveBeenCalledWith(PROJECT, 'volunteer.manageShifts');
		expect(mocks.createWorkOrder).not.toHaveBeenCalled();
	});

	it('refuses a signed-out caller before reading the project', async () => {
		signedIn = false;
		await expect(submit(input)).rejects.toMatchObject({ status: 401 });
		expect(mocks.getProjectById).not.toHaveBeenCalled();
		expect(mocks.createWorkOrder).not.toHaveBeenCalled();
	});
});
