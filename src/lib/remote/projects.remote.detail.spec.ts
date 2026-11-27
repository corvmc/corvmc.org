import { describe, it, expect, vi } from 'vitest';
import type { z } from 'zod';

// The project page draws its tasks through `TaskCatalogue`, so the page's
// load-bearing query carries the counts and none of the rows (#2647).

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw)), { __: { type: 'query' } }),
	form: () => Object.assign(async () => undefined, { __: { type: 'form' } })
}));
const can = vi.hoisted(() => vi.fn(async (_cap: string, _scope?: unknown) => true));
vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'user-1' }),
	can: (cap: string, scope?: unknown) => can(cap, scope),
	requireCapability: async () => ({ id: 'user-1' })
}));

vi.mock('#lib/server/project/project-service.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getProjectBurn: vi.fn(async () => ({}))
}));

const { getProjectDetail } = await import('./projects.remote');
const load = (id: string) =>
	(getProjectDetail as unknown as (id: string) => Promise<Record<string, unknown>>)(id);

function insert(table: string, row: Record<string, unknown>) {
	const keys = Object.keys(row);
	sqlite
		.prepare(
			`insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')})
			values (${keys.map(() => '?').join(', ')})`
		)
		.run(...keys.map((k) => row[k]));
}

describe('the project detail', () => {
	it('counts done over live tasks and carries no task rows', async () => {
		insert('project', { id: 'proj-1', name: 'Renovation' });
		const task = (id: string, cols: Record<string, unknown> = {}) =>
			insert('work_order', { id: `task-${id}`, project_id: 'proj-1', title: id, ...cols });
		task('ticked', { resolved_at: 1 });
		task('derived', { done_when: 'tasks_ticked' });
		insert('work_task', {
			id: 'd',
			work_order_id: 'task-derived',
			label: 'x',
			done: 1,
			done_at: 1,
			sort_order: 0
		});
		task('open');
		task('called-off', { cancelled_at: 1 });

		const detail = await load('proj-1');

		expect(detail.progress).toEqual({ done: 2, total: 3 });
		expect(JSON.stringify(detail)).not.toMatch(/task-/);
	});

	it('carries the cost sheet only for a production, and who may edit it', async () => {
		insert('project', { id: 'plain', name: 'Renovation 2' });
		insert('project', { id: 'show', name: 'Show', kind: 'production' });
		insert('production', { id: 'prod-1', project_id: 'show', status: 'draft' });
		insert('production_expense', {
			id: 'exp-1',
			production_id: 'prod-1',
			label: 'PA',
			category: 'sound',
			amount_cents: 500
		});

		expect((await load('plain')).costs).toBeNull();

		const asRunner = await load('show');
		expect(asRunner.canEditCosts).toBe(true);
		expect(asRunner.costs).toMatchObject({
			productionId: 'prod-1',
			lines: [expect.objectContaining({ id: 'exp-1' })]
		});

		can.mockImplementation(async (cap) => cap !== 'production.run');
		expect((await load('show')).canEditCosts).toBe(false);
		expect(can).toHaveBeenCalledWith('production.run', { projectId: 'show' });
	});
});
