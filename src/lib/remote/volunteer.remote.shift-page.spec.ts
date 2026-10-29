import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The shift page's query guards itself before it reads anything (#1907). It
 * used to be safe only because a guarded query sat in its `Promise.all`.
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

vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

let permitted = true;
// What `can()` answers yes to; `requireCapability` still reads `permitted`.
let granted = new Set(['volunteer.read', 'contractor.read', 'contractor.manage']);
const requested: string[] = [];
vi.mock('$lib/server/authorization', async () => {
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

const loadWorkOrderView = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/volunteer/work-order-view', () => ({ loadWorkOrderView }));
const listContractors = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/contractor/contractor-service', () => ({ listContractors }));

const { getStaffShiftPage } = (await import('./volunteer.remote')) as unknown as {
	getStaffShiftPage: (id: string) => Promise<unknown>;
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
});

describe('getStaffShiftPage', () => {
	it('refuses a caller without volunteer.read before reading the work order', async () => {
		permitted = false;
		await expect(getStaffShiftPage('wo-1')).rejects.toMatchObject({ status: 403 });
		expect(requested).toEqual(['volunteer.read']);
		expect(loadWorkOrderView).not.toHaveBeenCalled();
	});

	it('serves the view, with who can be engaged on it, to a caller who has it', async () => {
		loadWorkOrderView.mockResolvedValue({ shift: { id: 'wo-1' } });
		listContractors.mockResolvedValue([
			{ id: 'c-1', name: 'Benton Electric', trade: 'electrical' }
		]);
		await expect(getStaffShiftPage('wo-1')).resolves.toEqual({
			shift: { id: 'wo-1' },
			contractors: [{ id: 'c-1', name: 'Benton Electric' }]
		});
	});

	// #2071: a volunteer coordinator holds volunteer.read but not contractor.read.
	it('serves no engagements (quote, cost, invoice) without contractor.read', async () => {
		granted = new Set(['volunteer.read']);
		loadWorkOrderView.mockResolvedValue({ shift: { id: 'wo-1' }, engagements: [engagement] });
		const page = (await getStaffShiftPage('wo-1')) as Record<string, unknown>;
		expect(page.engagements).toEqual([]);
		expect(page.contractors).toEqual([]);
		expect(JSON.stringify(page)).not.toMatch(/costCents|invoiceRef|quotedCents|Benton/);
	});

	it('serves the engagements to a caller with contractor.read', async () => {
		granted = new Set(['volunteer.read', 'contractor.read']);
		loadWorkOrderView.mockResolvedValue({ shift: { id: 'wo-1' }, engagements: [engagement] });
		const page = (await getStaffShiftPage('wo-1')) as Record<string, unknown>;
		expect(page.engagements).toEqual([engagement]);
		expect(page.contractors).toEqual([]);
	});

	it('404s on a work order that does not exist', async () => {
		loadWorkOrderView.mockResolvedValue(null);
		await expect(getStaffShiftPage('nope')).rejects.toMatchObject({ status: 404 });
	});
});
