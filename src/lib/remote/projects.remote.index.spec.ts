import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// The Projects index filters by kind, so a show's project can be found among
// the general ones or kept out of them (production-projects-spec.md, phase 3).

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
	it('passes a kind filter through to the service', async () => {
		await load({ kind: 'production' });
		expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ kind: 'production' }));
	});

	it('refuses a kind that does not exist', async () => {
		await expect(load({ kind: 'festival' })).rejects.toThrow();
		expect(listProjects).not.toHaveBeenCalled();
	});

	it('lists every kind when none is chosen', async () => {
		await load({});
		expect(listProjects).toHaveBeenCalledWith(
			expect.not.objectContaining({ kind: expect.anything() })
		);
	});
});
