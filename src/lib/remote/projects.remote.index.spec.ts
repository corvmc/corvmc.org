import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// The Projects view is general projects only (productions are their own
// view, #2101), active by default, with archived projects a filter away (#1935).

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw)), { __: { type: 'query' } }),
	form: () => Object.assign(async () => undefined, { __: { type: 'form' } })
}));

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'user-1' }),
	can: async () => true,
	requireCapability: async () => ({ id: 'user-1' })
}));
vi.mock('$lib/server/group/group-context', () => ({ requireProjectCommittee: vi.fn() }));

const listProjects = vi.hoisted(() => vi.fn(async (_opts: unknown) => [] as unknown[]));
vi.mock('$lib/server/project/project-service', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listProjects,
	listCommittees: vi.fn(async () => []),
	getProjectBurn: vi.fn(async () => ({}))
}));

const { getProjectsPage } = await import('./projects.remote');
const load = (filters: unknown) =>
	(getProjectsPage as unknown as (f: unknown) => Promise<unknown>)(filters);

beforeEach(() => listProjects.mockClear());

describe('the Projects index', () => {
	it('never lists productions, whatever the client asks for', async () => {
		await load({ kind: 'production' });
		expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ kind: 'general' }));
	});

	it('shows only active projects by default', async () => {
		await load({});
		expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ archived: false }));
	});

	it('shows only archived projects in the archived view', async () => {
		await load({ view: 'archived' });
		expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ archived: true }));
	});

	it('shows both in the all view', async () => {
		await load({ view: 'all' });
		expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ archived: undefined }));
	});

	it('refuses a view that does not exist', async () => {
		await expect(load({ view: 'planned' })).rejects.toThrow();
		expect(listProjects).not.toHaveBeenCalled();
	});
});
