import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * "New Work Order" is one form for work with a time and work without (#1933).
 * The checkbox decides which service writes it, and a timed one needs both ends.
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	// Field issues come back as their message, which `invalid()` then carries.
	const issue = new Proxy({}, { get: (_, key) => (message: string) => ({ key, message }) });
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: () => mark(() => ({ refresh: async () => {} }), 'query'),
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), issue), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});

vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'usr-1' }),
	can: async () => true,
	requireCapability: async () => ({ id: 'staff-1' })
}));

const svc = vi.hoisted(() => ({ createShift: vi.fn(), createWorkOrder: vi.fn() }));
vi.mock('$lib/server/volunteer/work-order-service', async (orig) => ({
	...(await orig<object>()),
	createShift: svc.createShift,
	createWorkOrder: svc.createWorkOrder
}));

const { createWorkOrder } = (await import('./volunteer.remote')) as unknown as {
	createWorkOrder: (raw: Record<string, unknown>) => Promise<unknown>;
};

beforeEach(() => {
	svc.createShift.mockReset().mockResolvedValue({ id: 'wo-1' });
	svc.createWorkOrder.mockReset().mockResolvedValue({ id: 'wo-2' });
});

describe('createWorkOrder', () => {
	it('writes a posted shift when it has a set time', async () => {
		await createWorkOrder({
			volunteerRoleId: 'role-1',
			timed: true,
			startsAt: '2026-10-20T18:00',
			endsAt: '2026-10-20T22:00',
			capacity: '2'
		});

		expect(svc.createShift).toHaveBeenCalledWith(
			expect.objectContaining({
				volunteerRoleId: 'role-1',
				startsAt: '2026-10-20T18:00',
				endsAt: '2026-10-20T22:00',
				capacity: 2,
				createdByUserId: 'staff-1'
			})
		);
		expect(svc.createWorkOrder).not.toHaveBeenCalled();
	});

	it('writes an unscheduled order, ignoring any window, when it has none', async () => {
		await createWorkOrder({ volunteerRoleId: 'role-1', startsAt: '2026-10-20T18:00' });

		expect(svc.createWorkOrder).toHaveBeenCalledWith(
			expect.objectContaining({ volunteerRoleId: 'role-1', dueAt: null, capacity: 1 })
		);
		expect(svc.createShift).not.toHaveBeenCalled();
	});

	it('refuses a set time with no end, before writing anything', async () => {
		await expect(
			createWorkOrder({ volunteerRoleId: 'role-1', timed: true, startsAt: '2026-10-20T18:00' })
		).rejects.toBeDefined();

		expect(svc.createShift).not.toHaveBeenCalled();
		expect(svc.createWorkOrder).not.toHaveBeenCalled();
	});
});
