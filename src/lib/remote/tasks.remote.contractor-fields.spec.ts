import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * A project's committee reaches its task list and task pages under
 * `project.manage`, which says nothing about contractor money. Quote, cost and
 * invoice ride out only to a caller who also holds `contractor.read` (#2071).
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
vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('./projects.remote', () => ({ getProjectActivity: vi.fn(), getProjectDetail: vi.fn() }));

let granted = new Set<string>();
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'usr-1' }),
	can: async (cap: string) => granted.has(cap),
	requireCapability: async () => ({ id: 'usr-1' })
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireProjectCommittee: async () => ({ user: { id: 'usr-1' }, groups: [], via: 'committee' })
}));
vi.mock('$lib/server/project/project-service', () => ({
	getProjectById: async (id: string) => ({ id, name: 'Rewire the hall' })
}));

const loadWorkOrderView = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/volunteer/work-order-view', () => ({ loadWorkOrderView }));
const listProjectTasks = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/project/project-task-service', async (original) => ({
	...(await original<object>()),
	listProjectTasks,
	requireTaskInProject: async () => {}
}));

const { getProjectTaskPage, getProjectTasks } = (await import('./tasks.remote')) as unknown as {
	getProjectTaskPage: (raw: unknown) => Promise<Record<string, unknown>>;
	getProjectTasks: (raw: unknown) => Promise<Record<string, unknown>>;
};

const PROJECT = '00000000-0000-4000-8000-000000000001';
const MONEY = /costCents":\d|invoiceRef":"|quotedCents":\d|fairValueCents":\d|paidAt":"/;

const engagementRow = {
	job: { id: 'job-1', quotedCents: 50000, costCents: 48000, invoiceRef: 'INV-7' },
	contractor: { id: 'c-1', name: 'Benton Electric' }
};
const taskEngagement = {
	id: 'job-1',
	contractorId: 'c-1',
	contractorName: 'Benton Electric',
	status: 'completed',
	quotedCents: 50000,
	costCents: 48000,
	isDonated: false,
	fairValueCents: 60000,
	invoiceRef: 'INV-7',
	paidAt: new Date('2026-10-01T00:00:00Z'),
	scheduledFor: null
};

beforeEach(() => {
	granted = new Set();
	loadWorkOrderView.mockResolvedValue({ shift: { id: 'wo-1' }, engagements: [engagementRow] });
	listProjectTasks.mockResolvedValue({
		sections: [],
		committee: null,
		tasks: [{ id: 'wo-1', mode: 'contractor', engagement: taskEngagement }],
		progress: { done: 0, total: 1 }
	});
});

describe('getProjectTaskPage', () => {
	it('serves no engagements to a committee member without contractor.read', async () => {
		const page = await getProjectTaskPage({ projectId: PROJECT, workOrderId: 'wo-1' });
		expect(page.engagements).toEqual([]);
		expect(JSON.stringify(page)).not.toMatch(/INV-7|48000|Benton/);
	});

	it('serves them with contractor.read', async () => {
		granted = new Set(['project.read', 'contractor.read']);
		const page = await getProjectTaskPage({ projectId: PROJECT, workOrderId: 'wo-1' });
		expect(page.engagements).toEqual([engagementRow]);
	});
});

describe('getProjectTasks', () => {
	it('keeps who is engaged but drops what they cost, without contractor.read', async () => {
		const list = await getProjectTasks(PROJECT);
		expect(list.contractorMoney).toBe(false);
		const [task] = list.tasks as { engagement: Record<string, unknown> }[];
		expect(task.engagement).toMatchObject({
			contractorName: 'Benton Electric',
			status: 'completed'
		});
		expect(JSON.stringify(list)).not.toMatch(MONEY);
	});

	it('serves the money with contractor.read', async () => {
		granted = new Set(['contractor.read']);
		const list = await getProjectTasks(PROJECT);
		expect(list.contractorMoney).toBe(true);
		const [task] = list.tasks as { engagement: Record<string, unknown> }[];
		expect(task.engagement).toEqual(taskEngagement);
	});
});
