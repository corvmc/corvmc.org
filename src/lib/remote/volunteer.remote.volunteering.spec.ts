import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * Volunteering's query (#2625) is `volunteer.read`'s, checked first. It reads
 * shifts only: tasks with no shift and contractor work are Tasks'.
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

vi.mock('#lib/server/db/index.js', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const held = new Set<string>();
vi.mock('#lib/server/authorization.js', async () => {
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

const svc = vi.hoisted(() => ({ listShifts: vi.fn(), listWorkOrders: vi.fn() }));
vi.mock('#lib/server/volunteer/work-order-service.js', () => svc);

const waiting = vi.hoisted(() => ({
	ended: [] as { id: string }[],
	lapsing: [] as { userId: string }[]
}));
const listTasksWithEndedShifts = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/volunteer/ended-shifts.js', () => ({ listTasksWithEndedShifts }));
// `?about=` (#2630): the record's relations as one condition, passed through untouched.
vi.mock('#lib/server/task/related-tasks.js', () => ({
	aboutWhere: (subject: object) => ({ about: subject })
}));
vi.mock('#lib/server/volunteer/member-certification-service.js', async (orig) => ({
	...(await orig<object>()),
	listLapsingBeforeRosteredShift: async () => waiting.lapsing
}));

const { getVolunteeringPage } = (await import('./volunteer.remote')) as unknown as {
	getVolunteeringPage: (args: object) => Promise<{
		shifts: { id: string }[];
		ended: { id: string }[];
		lapsingPeople: number;
	}>;
};

beforeEach(() => {
	held.clear();
	svc.listShifts.mockReset().mockResolvedValue([{ id: 'wo-1' }]);
	svc.listWorkOrders.mockReset();
	waiting.ended = [];
	waiting.lapsing = [];
	listTasksWithEndedShifts.mockReset().mockImplementation(async () => waiting.ended);
});

describe('getVolunteeringPage', () => {
	it('refuses a caller without volunteer.read before reading anything', async () => {
		await expect(getVolunteeringPage({})).rejects.toMatchObject({ status: 403 });
		expect(svc.listShifts).not.toHaveBeenCalled();
	});

	it('reads the window and role as shifts, and no task without one', async () => {
		held.add('volunteer.read');
		const from = '2030-01-01T00:00:00.000Z';
		const to = '2030-01-15T00:00:00.000Z';
		const page = await getVolunteeringPage({ from, to, volunteerRoleId: 'door' });
		expect(svc.listShifts).toHaveBeenCalledWith(
			expect.objectContaining({ from: new Date(from), to: new Date(to), volunteerRoleId: 'door' })
		);
		expect(svc.listWorkOrders).not.toHaveBeenCalled();
		expect(page.shifts).toEqual([{ id: 'wo-1' }]);
	});

	it('counts each person with a lapsing clearance once, beside the ended tasks', async () => {
		held.add('volunteer.read');
		waiting.ended = [{ id: 'wo-ended' }];
		waiting.lapsing = [{ userId: 'u1' }, { userId: 'u1' }, { userId: 'u2' }];
		const page = await getVolunteeringPage({});
		expect(page.ended).toEqual([{ id: 'wo-ended' }]);
		expect(page.lapsingPeople).toBe(2);
	});

	it("narrows the shifts and the ended tasks to a record's relations", async () => {
		held.add('volunteer.read');
		const about = { type: 'event', id: 'e1' };
		await getVolunteeringPage({ about });
		expect(svc.listShifts).toHaveBeenCalledWith(expect.objectContaining({ where: { about } }));
		expect(listTasksWithEndedShifts).toHaveBeenCalledWith(expect.any(Date), { about });

		await getVolunteeringPage({});
		expect(svc.listShifts).toHaveBeenLastCalledWith(expect.objectContaining({ where: undefined }));
	});
});
