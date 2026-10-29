import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * Schedule's contractor filter (#2069): contractor data is behind
 * `contractor.read` on the remote, whichever branch of the query asks for it.
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: (...args: unknown[]) => {
			const schema = (typeof args[0] === 'function' ? undefined : args[0]) as z.ZodType | undefined;
			const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
				...a: unknown[]
			) => unknown;
			return mark(async (raw: unknown) => handler(schema ? schema.parse(raw) : raw), 'query');
		},
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});

vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const held = new Set<string>();
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => ({ id: 'usr-1' }),
		can: async (cap: string) => held.has(cap),
		requireCapability: async (cap: string) => {
			if (!held.has(cap)) throw error(403, 'Not permitted');
			return { id: 'usr-1' };
		}
	};
});

const svc = vi.hoisted(() => ({
	listShifts: vi.fn(),
	listWorkOrders: vi.fn(),
	listWorkOrdersByIds: vi.fn(),
	listJobs: vi.fn()
}));
vi.mock('$lib/server/volunteer/work-order-service', () => ({
	listShifts: svc.listShifts,
	listWorkOrders: svc.listWorkOrders,
	listWorkOrdersByIds: svc.listWorkOrdersByIds,
	isScheduled: (w: { startsAt: Date | null; endsAt: Date | null }) =>
		w.startsAt !== null && w.endsAt !== null
}));
vi.mock('$lib/server/contractor/contractor-job-service', () => ({ listJobs: svc.listJobs }));

const { getSchedulePage } = (await import('./volunteer.remote')) as unknown as {
	getSchedulePage: (args: object) => Promise<{
		shifts: { id: string }[];
		unscheduled: { id: string }[];
		contractors: Record<string, { name: string; late: boolean; awaitingInvoice: boolean }[]>;
		contractorAccess: boolean;
	}>;
};

const created = new Date('2026-10-01T00:00:00Z');
const wo = (id: string, startsAt: Date | null = null) => ({
	id,
	startsAt,
	endsAt: startsAt ? new Date(startsAt.getTime() + 3_600_000) : null,
	dueAt: null,
	createdAt: created
});
const job = (workOrderId: string, marks: { late?: boolean; awaitingInvoice?: boolean } = {}) => ({
	job: { workOrderId },
	contractor: { name: 'Benton Electric' },
	late: marks.late ?? false,
	awaitingInvoice: marks.awaitingInvoice ?? false
});

beforeEach(() => {
	held.clear();
	held.add('volunteer.read');
	for (const fn of Object.values(svc)) fn.mockReset();
	svc.listShifts.mockResolvedValue([]);
	svc.listWorkOrders.mockResolvedValue([]);
	svc.listJobs.mockResolvedValue([]);
	svc.listWorkOrdersByIds.mockResolvedValue([]);
});

describe('getSchedulePage, contractor filter', () => {
	it('refuses a caller without contractor.read before reading any engagement', async () => {
		await expect(getSchedulePage({ contractor: 'late' })).rejects.toMatchObject({ status: 403 });
		expect(svc.listJobs).not.toHaveBeenCalled();
	});

	it('returns the work orders a contractor fulfils, split by whether they have a time', async () => {
		held.add('contractor.read');
		svc.listJobs.mockResolvedValue([
			job('wo-late', { late: true }),
			job('wo-timed'),
			job('wo-late')
		]);
		svc.listWorkOrdersByIds.mockResolvedValue([wo('wo-late'), wo('wo-timed', created)]);

		const page = await getSchedulePage({ contractor: 'all' });

		expect(svc.listJobs).toHaveBeenCalledWith({ view: 'all' });
		expect(svc.listWorkOrdersByIds).toHaveBeenCalledWith(['wo-late', 'wo-timed']);
		expect(page.shifts.map((w) => w.id)).toEqual(['wo-timed']);
		expect(page.unscheduled.map((w) => w.id)).toEqual(['wo-late']);
		expect(page.contractors['wo-late']).toHaveLength(2);
		expect(page.contractors['wo-late'][0]).toEqual({
			name: 'Benton Electric',
			late: true,
			awaitingInvoice: false
		});
		expect(svc.listShifts).not.toHaveBeenCalled();
	});

	it('passes Late and Awaiting invoice through to the service’s own filter', async () => {
		held.add('contractor.read');
		await getSchedulePage({ contractor: 'awaiting-invoice' });
		expect(svc.listJobs).toHaveBeenCalledWith({ view: 'awaiting-invoice' });
		await getSchedulePage({ contractor: 'late' });
		expect(svc.listJobs).toHaveBeenLastCalledWith({ view: 'late' });
	});

	it('rejects a view that is not one', async () => {
		held.add('contractor.read');
		await expect(getSchedulePage({ contractor: 'overdue' })).rejects.toThrow();
	});
});

describe('getSchedulePage, unfiltered', () => {
	it('marks rows with their contractor for a caller with contractor.read', async () => {
		held.add('contractor.read');
		svc.listWorkOrders.mockResolvedValue([wo('wo-1')]);
		svc.listJobs.mockResolvedValue([job('wo-1', { awaitingInvoice: true })]);

		const page = await getSchedulePage({});

		expect(svc.listJobs).toHaveBeenCalledWith({ workOrderIds: ['wo-1'] });
		expect(page.contractors['wo-1'][0].awaitingInvoice).toBe(true);
	});

	it('reads no contractor data for a caller without contractor.read', async () => {
		svc.listWorkOrders.mockResolvedValue([wo('wo-1')]);

		const page = await getSchedulePage({});

		expect(svc.listJobs).not.toHaveBeenCalled();
		expect(page.contractors).toEqual({});
		expect(page.contractorAccess).toBe(false);
		expect(page.unscheduled.map((w) => w.id)).toEqual(['wo-1']);
	});
});
