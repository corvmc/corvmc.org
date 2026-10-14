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
const requested: string[] = [];
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => ({ id: 'usr-1' }),
		can: async () => permitted,
		requireCapability: async (cap: string) => {
			requested.push(cap);
			if (!permitted) throw error(403, 'Not permitted');
			return { id: 'usr-1' };
		}
	};
});

const loadWorkOrderView = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/volunteer/work-order-view', () => ({ loadWorkOrderView }));

const { getStaffShiftPage } = (await import('./volunteer.remote')) as unknown as {
	getStaffShiftPage: (id: string) => Promise<unknown>;
};

beforeEach(() => {
	permitted = true;
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

	it('serves the view to a caller who has it', async () => {
		loadWorkOrderView.mockResolvedValue({ shift: { id: 'wo-1' } });
		await expect(getStaffShiftPage('wo-1')).resolves.toEqual({ shift: { id: 'wo-1' } });
	});

	it('404s on a work order that does not exist', async () => {
		loadWorkOrderView.mockResolvedValue(null);
		await expect(getStaffShiftPage('nope')).rejects.toMatchObject({ status: 404 });
	});
});
