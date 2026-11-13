import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * `getRelatedShifts` and `addRelatedShift` (#2630): the record's read guard
 * first, then Volunteering's; Add shift opens a shift only on one of the
 * record's tasks, or on a new task that has a role.
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	const issue = new Proxy(
		{},
		{ get: (_t, key) => (message: string) => ({ message, path: [String(key)] }) }
	);
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			// Thenable with `refresh`, as a remote query is; the form refreshes the card after a write.
			mark(
				(raw: unknown) =>
					Object.assign(
						Promise.resolve().then(() => handler(schema.parse(raw))),
						{ refresh: async () => {} }
					),
				'query'
			),
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), issue), 'form'),
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
const requireListingReader = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/event/listing-guard.js', () => ({ requireListingReader }));
const newTaskPrefill = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/task/related-tasks.js', () => ({
	relatedTasks: vi.fn(),
	newTaskPrefill,
	aboutWhere: vi.fn()
}));
const shifts = vi.hoisted(() => ({
	relatedShifts: vi.fn(),
	relatedEndedShifts: vi.fn(),
	relatedShiftTasks: vi.fn(),
	isRelatedTask: vi.fn()
}));
vi.mock('#lib/server/task/related-shifts.js', () => shifts);
const svc = vi.hoisted(() => ({ createWorkOrder: vi.fn(), openShift: vi.fn() }));
vi.mock('#lib/server/volunteer/work-order-service.js', async (original) => ({
	...(await original<Record<string, unknown>>()),
	...svc
}));
vi.mock('#lib/server/volunteer/volunteer-role-service.js', () => ({
	listVolunteerRoles: async () => [
		{ id: 'door', name: 'Door', defaultCapacity: 2, defaultDurationMinutes: 240 }
	]
}));

type Fn = (raw: unknown) => Promise<Record<string, unknown> | null>;
const { getRelatedShifts, addRelatedShift } = (await import('./tasks.remote')) as unknown as {
	getRelatedShifts: Fn;
	addRelatedShift: Fn;
};

const times = { startsAt: '2031-05-10T18:00', endsAt: '2031-05-10T22:00' };

beforeEach(() => {
	granted = new Set();
	requireListingReader.mockReset();
	newTaskPrefill.mockReset().mockResolvedValue({ groupId: 'g1' });
	shifts.relatedShifts.mockReset().mockResolvedValue([]);
	shifts.relatedEndedShifts.mockReset().mockResolvedValue([{ id: 'wo-9' }]);
	shifts.relatedShiftTasks.mockReset().mockResolvedValue([]);
	shifts.isRelatedTask.mockReset().mockResolvedValue(true);
	svc.createWorkOrder.mockReset().mockResolvedValue({ id: 'wo-new' });
	svc.openShift.mockReset().mockResolvedValue({ id: 's-1' });
});

describe('getRelatedShifts', () => {
	it("refuses without the record's own read capability", async () => {
		granted = new Set(['volunteer.read']);
		await expect(getRelatedShifts({ type: 'group', id: 'g1' })).rejects.toMatchObject({
			status: 403
		});
		expect(shifts.relatedShifts).not.toHaveBeenCalled();
	});

	it('reads nothing for a record reader without volunteer.read', async () => {
		granted = new Set(['group.read']);
		expect(await getRelatedShifts({ type: 'group', id: 'g1' })).toBeNull();
		expect(shifts.relatedShifts).not.toHaveBeenCalled();
	});

	it("guards an event with the listing's reader check", async () => {
		granted = new Set(['volunteer.read']);
		await getRelatedShifts({ type: 'event', id: 'e1' });
		expect(requireListingReader).toHaveBeenCalledWith('e1');
	});

	it('offers Add shift only to a viewer who can open shifts', async () => {
		granted = new Set(['group.read', 'volunteer.read']);
		const read = await getRelatedShifts({ type: 'group', id: 'g1' });
		expect(read).toMatchObject({ ended: 1, addShift: null });
		expect(shifts.relatedShiftTasks).not.toHaveBeenCalled();

		granted.add('volunteer.manageShifts');
		const manage = await getRelatedShifts({ type: 'group', id: 'g1' });
		expect(manage?.addShift).toMatchObject({ newTask: { roleId: null } });
	});
});

describe('addRelatedShift', () => {
	const run = (data: Record<string, unknown>) =>
		addRelatedShift({ subjectType: 'group', subjectId: 'g1', ...times, ...data });

	beforeEach(() => {
		granted = new Set(['group.read', 'volunteer.read', 'volunteer.manageShifts']);
	});

	it('refuses without volunteer.manageShifts', async () => {
		granted.delete('volunteer.manageShifts');
		await expect(run({ taskId: 'wo-1' })).rejects.toMatchObject({ status: 403 });
		expect(svc.openShift).not.toHaveBeenCalled();
	});

	it("opens a shift on one of the record's tasks", async () => {
		expect(await run({ taskId: 'wo-1', capacity: '3' })).toEqual({ id: 'wo-1' });
		expect(svc.openShift).toHaveBeenCalledWith(
			'wo-1',
			expect.objectContaining({ ...times, capacity: 3 })
		);
		expect(svc.createWorkOrder).not.toHaveBeenCalled();
	});

	it('refuses a task that is not the record’s', async () => {
		shifts.isRelatedTask.mockResolvedValue(false);
		await expect(run({ taskId: 'wo-other' })).rejects.toThrow();
		expect(svc.openShift).not.toHaveBeenCalled();
	});

	it('makes no task without a role, since a shift needs one', async () => {
		await expect(run({ taskId: '' })).rejects.toThrow();
		expect(svc.createWorkOrder).not.toHaveBeenCalled();
	});

	it("makes a new task on the record's anchors, then opens the shift on it", async () => {
		expect(await run({ taskId: '', volunteerRoleId: 'door', title: 'Bar' })).toEqual({
			id: 'wo-new'
		});
		expect(svc.createWorkOrder).toHaveBeenCalledWith(
			expect.objectContaining({ groupId: 'g1', volunteerRoleId: 'door', title: 'Bar' })
		);
		expect(svc.openShift).toHaveBeenCalledWith('wo-new', expect.objectContaining(times));
	});

	it('makes no task when the times are refused', async () => {
		await expect(
			run({ taskId: '', volunteerRoleId: 'door', endsAt: times.startsAt })
		).rejects.toThrow();
		expect(svc.createWorkOrder).not.toHaveBeenCalled();
	});
});
