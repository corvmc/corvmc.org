import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The Tasks table's query (#2625) is `project.read`'s, checked before anything
 * is read. Who is engaged, and what is owed them, reaches only a caller who
 * also holds `contractor.read` (#2071).
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: (_schema: unknown, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(raw), 'query'),
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});
vi.mock('#lib/server/db/index.js', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('./projects.remote', () => ({ getProjectActivity: vi.fn(), getProjectDetail: vi.fn() }));

let granted = new Set<string>();
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => ({ id: 'usr-1' }),
		can: async (cap: string) => granted.has(cap),
		requireCapability: async (cap: string) => {
			if (!granted.has(cap)) error(403, 'Not permitted');
			return { id: 'usr-1' };
		}
	};
});
vi.mock('#lib/server/project/project-service.js', () => ({
	getProjectById: vi.fn(),
	listProjects: async () => [{ id: 'p1', name: 'Rewire the hall', budgetCents: 100 }],
	listCommittees: async () => [{ id: 'g1', name: 'Facilities' }]
}));
vi.mock('#lib/server/volunteer/duty-list-service.js', () => ({
	listDutyLists: async () => [
		{ id: 't1', name: 'Show deliverables', itemCount: 3 },
		{ id: 't2', name: 'Empty', itemCount: 0 }
	]
}));
const listTaskCatalogue = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/volunteer/task-catalogue.js', () => ({ listTaskCatalogue }));
const listJobs = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/contractor/contractor-job-service.js', () => ({ listJobs }));

const { getTasksPage } = (await import('./tasks.remote')) as unknown as {
	getTasksPage: (raw: unknown) => Promise<Record<string, unknown>>;
};

const job = (workOrderId: string, awaitingInvoice: boolean) => ({
	job: { workOrderId, costCents: null },
	contractor: { name: 'Benton Electric' },
	late: false,
	awaitingInvoice
});

beforeEach(() => {
	granted = new Set();
	listTaskCatalogue.mockReset().mockResolvedValue([{ id: 'wo-1' }]);
	listJobs.mockReset();
	listJobs.mockImplementation(async ({ view }: { view: string }) =>
		view === 'open' ? [job('wo-1', false)] : [job('wo-2', true)]
	);
});

describe('getTasksPage', () => {
	it('refuses a caller without project.read before reading anything', async () => {
		await expect(getTasksPage({})).rejects.toMatchObject({ status: 403 });
		expect(listTaskCatalogue).not.toHaveBeenCalled();
	});

	it('leaves out engagements and owed invoices without contractor.read', async () => {
		granted = new Set(['project.read']);
		const page = await getTasksPage({});
		expect(page.contractors).toEqual({});
		expect(listJobs).not.toHaveBeenCalled();
		expect(listTaskCatalogue).toHaveBeenCalledWith(
			expect.objectContaining({ withAwaitingInvoice: false })
		);
		expect(JSON.stringify(page)).not.toMatch(/Benton/);
	});

	it('marks open and invoice-owed engagements by task with contractor.read', async () => {
		granted = new Set(['project.read', 'contractor.read']);
		const page = await getTasksPage({ includeDone: true });
		expect(page.contractors).toEqual({
			'wo-1': [{ name: 'Benton Electric', late: false, awaitingInvoice: false }],
			'wo-2': [{ name: 'Benton Electric', late: false, awaitingInvoice: true }]
		});
		expect(listTaskCatalogue).toHaveBeenCalledWith({
			volunteerRoleId: undefined,
			includeDone: true,
			withAwaitingInvoice: true
		});
	});

	it('offers only templates with items, and projects by id and name', async () => {
		granted = new Set(['project.read']);
		const page = await getTasksPage({});
		expect(page.templates).toEqual([{ id: 't1', name: 'Show deliverables' }]);
		expect(page.projects).toEqual([{ id: 'p1', name: 'Rewire the hall' }]);
	});
});
