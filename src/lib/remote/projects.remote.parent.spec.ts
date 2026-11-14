import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// Setting a project's parent is a project edit: `project.manage` first, and
// nothing written when it refuses (#2543).

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: () => Object.assign(() => ({ refresh: async () => {} }), { __: { type: 'query' } }),
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } })
}));

const mocks = vi.hoisted(() => ({ requireCapability: vi.fn(), updateProject: vi.fn() }));
vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'user-1' }),
	can: async () => true,
	requireCapability: mocks.requireCapability
}));
vi.mock('#lib/server/project/project-service.js', () => ({ updateProject: mocks.updateProject }));
vi.mock('#lib/server/volunteer/duty-list-service.js', () => ({}));
vi.mock('#lib/remote/groups.remote.js', () => ({ getMemberGroup: () => ({ refresh: vi.fn() }) }));
vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

const { updateProjectForm: submit } = (await import('./projects.remote')) as unknown as Record<
	string,
	(arg: unknown) => Promise<unknown>
>;

const CHILD = '00000000-0000-4000-8000-000000000001';
const PARENT = '00000000-0000-4000-8000-000000000002';

describe('updateProjectForm parent', () => {
	beforeEach(() => vi.clearAllMocks());

	it('writes nothing without project.manage', async () => {
		const { error } = await import('@sveltejs/kit');
		mocks.requireCapability.mockImplementation(async () => error(403, 'Forbidden'));

		await expect(
			submit({ id: CHILD, name: 'Night one', parentProjectId: PARENT })
		).rejects.toMatchObject({ status: 403 });
		expect(mocks.requireCapability).toHaveBeenCalledWith('project.manage', { projectId: CHILD });
		expect(mocks.updateProject).not.toHaveBeenCalled();
	});

	it('passes the parent to the service, and an emptied picker as none', async () => {
		mocks.requireCapability.mockResolvedValue({ id: 'user-1' });

		await submit({ id: CHILD, name: 'Night one', parentProjectId: PARENT });
		await submit({ id: CHILD, name: 'Night one', parentProjectId: '' });

		expect(mocks.updateProject.mock.calls.map((c) => c[1].parentProjectId)).toEqual([PARENT, null]);
	});
});
