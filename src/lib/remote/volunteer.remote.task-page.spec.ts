import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The task page's query guards itself before it reads anything (#1907), by the
 * project's rule for a task in a project and by either list's for one in none
 * (#2625).
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: (...args: unknown[]) => {
			const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
				...a: unknown[]
			) => unknown;
			return mark(async (raw: unknown) => handler(raw), 'query');
		},
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});

vi.mock('#lib/server/db/index.js', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

let permitted = true;
// What `can()` answers yes to; `requireCapability` still reads `permitted`.
let granted = new Set(['volunteer.read', 'contractor.read', 'contractor.manage']);
const requested: string[] = [];
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => ({ id: 'usr-1' }),
		can: async (cap: string) => permitted && granted.has(cap),
		requireCapability: async (cap: string) => {
			requested.push(cap);
			if (!permitted) throw error(403, 'Not permitted');
			return { id: 'usr-1' };
		}
	};
});

const workOrderProjectId = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/volunteer/work-order-service.js', async (original) => ({
	...(await original<object>()),
	workOrderProjectId
}));
const requireProjectCommittee = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/group/group-context.js', () => ({ requireProjectCommittee }));
vi.mock('#lib/server/project/project-service.js', async (original) => ({
	...(await original<object>()),
	getProjectById: async (id: string) => ({ id, name: 'Rewire the hall' })
}));
const edges = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock('#lib/server/volunteer/task-dependencies.js', () => ({
	listTaskDependencies: async () => ({ waitsOn: [], neededFor: [] }),
	listDependencyOptions: async () => [],
	addDependency: edges.add,
	removeDependency: edges.remove
}));
const loadWorkOrderView = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/volunteer/work-order-view.js', () => ({ loadWorkOrderView }));
const listContractors = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/contractor/contractor-service.js', () => ({ listContractors }));

const { getTaskPage, addTaskDependency, removeTaskDependency } =
	(await import('./volunteer.remote')) as unknown as {
		getTaskPage: (id: string) => Promise<unknown>;
		addTaskDependency: (raw: object) => Promise<unknown>;
		removeTaskDependency: (raw: object) => Promise<unknown>;
	};

const engagement = {
	job: { id: 'job-1', quotedCents: 50000, costCents: 48000, invoiceRef: 'INV-7' },
	contractor: { id: 'c-1', name: 'Benton Electric' }
};

beforeEach(() => {
	permitted = true;
	granted = new Set(['volunteer.read', 'contractor.read', 'contractor.manage']);
	requested.length = 0;
	loadWorkOrderView.mockReset();
	workOrderProjectId.mockReset().mockResolvedValue(null);
	requireProjectCommittee.mockReset().mockResolvedValue({});
});

describe('getTaskPage, for a task in no project', () => {
	it('refuses a caller with neither list before reading the work order', async () => {
		permitted = false;
		await expect(getTaskPage('wo-1')).rejects.toMatchObject({ status: 403 });
		expect(requested).toEqual(['volunteer.read']);
		expect(loadWorkOrderView).not.toHaveBeenCalled();
	});

	it('serves a project.read holder, who reads it on the Tasks table', async () => {
		granted = new Set(['project.read']);
		loadWorkOrderView.mockResolvedValue({ task: { id: 'wo-1' } });
		await expect(getTaskPage('wo-1')).resolves.toMatchObject({ project: null });
		expect(requested).toEqual([]);
	});

	it('serves the view, with who can be engaged on it, to a caller who has it', async () => {
		loadWorkOrderView.mockResolvedValue({ task: { id: 'wo-1' } });
		listContractors.mockResolvedValue([
			{ id: 'c-1', name: 'Benton Electric', trade: 'electrical' }
		]);
		await expect(getTaskPage('wo-1')).resolves.toEqual({
			project: null,
			task: { id: 'wo-1' },
			contractors: [{ id: 'c-1', name: 'Benton Electric' }],
			dependencies: { waitsOn: [], neededFor: [] },
			dependencyOptions: []
		});
	});

	// #2071: a volunteer coordinator holds volunteer.read but not contractor.read.
	it('serves no engagements (quote, cost, invoice) without contractor.read', async () => {
		granted = new Set(['volunteer.read']);
		loadWorkOrderView.mockResolvedValue({ task: { id: 'wo-1' }, engagements: [engagement] });
		const page = (await getTaskPage('wo-1')) as Record<string, unknown>;
		expect(page.engagements).toEqual([]);
		expect(page.contractors).toEqual([]);
		expect(JSON.stringify(page)).not.toMatch(/costCents|invoiceRef|quotedCents|Benton/);
	});

	it('serves the engagements to a caller with contractor.read', async () => {
		granted = new Set(['volunteer.read', 'contractor.read']);
		loadWorkOrderView.mockResolvedValue({ task: { id: 'wo-1' }, engagements: [engagement] });
		const page = (await getTaskPage('wo-1')) as Record<string, unknown>;
		expect(page.engagements).toEqual([engagement]);
		expect(page.contractors).toEqual([]);
	});

	it('404s on a work order that does not exist', async () => {
		workOrderProjectId.mockResolvedValue(undefined);
		await expect(getTaskPage('nope')).rejects.toMatchObject({ status: 404 });
		expect(loadWorkOrderView).not.toHaveBeenCalled();
	});
});

describe('getTaskPage, for a task in a project', () => {
	beforeEach(() => workOrderProjectId.mockResolvedValue('proj-1'));

	it('serves a project.read holder, naming the project', async () => {
		granted = new Set(['project.read']);
		loadWorkOrderView.mockResolvedValue({ task: { id: 'wo-1' } });
		await expect(getTaskPage('wo-1')).resolves.toMatchObject({
			project: { id: 'proj-1', name: 'Rewire the hall' }
		});
		expect(requireProjectCommittee).not.toHaveBeenCalled();
	});

	it('asks the owning committee of anybody else, before reading the work order', async () => {
		granted = new Set(['volunteer.read']);
		requireProjectCommittee.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
		await expect(getTaskPage('wo-1')).rejects.toMatchObject({ status: 403 });
		expect(requireProjectCommittee).toHaveBeenCalledWith('proj-1', 'project.manage');
		expect(loadWorkOrderView).not.toHaveBeenCalled();
	});

	it('serves no engagements to a committee member without contractor.read', async () => {
		granted = new Set();
		loadWorkOrderView.mockResolvedValue({ task: { id: 'wo-1' }, engagements: [engagement] });
		const page = (await getTaskPage('wo-1')) as Record<string, unknown>;
		expect(page.engagements).toEqual([]);
	});
});

describe('a task waiting on another (#2625)', () => {
	const edge = { workOrderId: 'wo-1', dependsOnId: 'wo-2' };
	beforeEach(() => {
		edges.add.mockReset();
		edges.remove.mockReset();
	});

	it("in no project, is the coordinator's write, refused before anything changes", async () => {
		permitted = false;
		await expect(addTaskDependency(edge)).rejects.toMatchObject({ status: 403 });
		expect(requested).toContain('volunteer.manageShifts');
		expect(edges.add).not.toHaveBeenCalled();
	});

	it("in a project, is the project's committee's write", async () => {
		workOrderProjectId.mockResolvedValue('proj-1');
		requireProjectCommittee.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }));
		await expect(removeTaskDependency(edge)).rejects.toMatchObject({ status: 403 });
		expect(requireProjectCommittee).toHaveBeenCalledWith('proj-1', 'project.manage');
		expect(edges.remove).not.toHaveBeenCalled();
	});
});
