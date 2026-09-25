import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// Booking acts on an event through the project it points at. The committees are
// read off that project, never off the request, and a refusal writes nothing.

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
	getEventProject: vi.fn(),
	publish: vi.fn(),
	refreshMemberGroup: vi.fn()
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireProjectCommittee: mocks.requireProjectCommittee
}));
vi.mock('$lib/server/project/project-service', () => ({
	getEventProject: mocks.getEventProject
}));
vi.mock('$lib/server/event/event-service', () => ({ publish: mocks.publish }));
vi.mock('$lib/remote/groups.remote', () => ({
	getMemberGroup: () => ({ refresh: mocks.refreshMemberGroup })
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { publishCommitteeProjectEventForm: submit } =
	(await import('./projects.remote')) as unknown as Record<
		string,
		(arg: unknown) => Promise<unknown>
	>;

describe('publishCommitteeProjectEventForm', () => {
	beforeEach(() => {
		signedIn = true;
		vi.clearAllMocks();
		mocks.getEventProject.mockResolvedValue({ projectId: 'proj-1' });
	});

	it('publishes for a member of a committee taking part in the project', async () => {
		mocks.requireProjectCommittee.mockResolvedValue({
			user: { id: 'user-1' },
			groups: [{ id: 'booking', slug: 'booking' }],
			via: 'committee'
		});

		await expect(submit({ id: 'evt-1' })).resolves.toEqual({ success: true });
		expect(mocks.requireProjectCommittee).toHaveBeenCalledWith('proj-1', 'event.publish');
		expect(mocks.publish).toHaveBeenCalledWith('evt-1');
		expect(mocks.refreshMemberGroup).toHaveBeenCalled();
	});

	it('refuses someone outside that committee, and publishes nothing', async () => {
		const { error } = await import('@sveltejs/kit');
		mocks.requireProjectCommittee.mockImplementation(async () => {
			throw error(403, 'Not a member of the committee that owns this');
		});

		await expect(submit({ id: 'evt-1' })).rejects.toMatchObject({ status: 403 });
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it('takes the committee from the project, not from a groupId in the request', async () => {
		const { error } = await import('@sveltejs/kit');
		mocks.requireProjectCommittee.mockImplementation(async (projectId: string) => {
			if (projectId !== 'my-committee') throw error(403, 'Not a member');
			return { user: { id: 'user-1' }, groups: [], via: 'committee' };
		});

		await expect(submit({ id: 'evt-1', groupId: 'my-committee' })).rejects.toMatchObject({
			status: 403
		});
		expect(mocks.requireProjectCommittee).toHaveBeenCalledWith('proj-1', 'event.publish');
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it('hands an event on no project to the guard with no project, so only cover applies', async () => {
		mocks.getEventProject.mockResolvedValue({ projectId: null });
		const { error } = await import('@sveltejs/kit');
		mocks.requireProjectCommittee.mockImplementation(async () => {
			throw error(403, 'Not permitted');
		});

		await expect(submit({ id: 'evt-1' })).rejects.toMatchObject({ status: 403 });
		expect(mocks.requireProjectCommittee).toHaveBeenCalledWith(null, 'event.publish');
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it('404s an event that does not exist, without consulting the guard', async () => {
		mocks.getEventProject.mockResolvedValue(null);

		await expect(submit({ id: 'gone' })).rejects.toMatchObject({ status: 404 });
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it('refuses a signed-out caller before reading anything', async () => {
		signedIn = false;
		await expect(submit({ id: 'evt-1' })).rejects.toMatchObject({ status: 401 });
		expect(mocks.getEventProject).not.toHaveBeenCalled();
		expect(mocks.publish).not.toHaveBeenCalled();
	});
});
