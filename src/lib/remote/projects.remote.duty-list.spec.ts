import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';
import { positionOrder, type Capability, type Position } from '$lib/config';

// Pins the guard on applying a duty list to a project against the real
// capability matrix, so a position gaining or losing it shows up here.

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		// Lazy, like kit's: a query that is only refreshed never runs its handler here.
		const call = (...a: unknown[]) => ({
			refresh: async () => {},
			then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
				Promise.resolve()
					.then(() => handler(...a))
					.then(ok, fail)
		});
		return Object.assign(call, { __: { type: 'query' } });
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } })
}));

let heldPositions: Position[] = [];
let signedIn = true;
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('$lib/config');
	return {
		requireUser: () => ({ id: 'user-1' }),
		requireCapability: async (cap: Capability) => {
			if (!signedIn) throw error(401, 'Not authenticated');
			if (!heldPositions.some((p) => config.grantsCapability(config.positions[p], cap)))
				throw error(403, 'Not permitted');
			return { id: 'user-1' };
		}
	};
});

const applyDutyList = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/volunteer/duty-list-service', () => ({
	applyDutyList,
	listDutyLists: vi.fn(async () => [])
}));
vi.mock('$lib/server/project/project-service', () => ({}));
vi.mock('$lib/server/group/group-context', () => ({ requireCommitteeMember: vi.fn() }));
vi.mock('$lib/remote/groups.remote', () => ({ getMemberGroup: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { applyDutyListToProjectForm } = (await import('./projects.remote')) as unknown as Record<
	string,
	(arg: unknown) => Promise<unknown>
>;

const PROJECT = '00000000-0000-4000-8000-000000000001';
const input = { projectId: PROJECT, dutyListId: 'dl-1' };

const { grantsCapability, positions } = await import('$lib/config');
const holders = positionOrder.filter((p) =>
	grantsCapability(positions[p], 'volunteer.manageShifts')
);
const others = positionOrder.filter(
	(p) => !grantsCapability(positions[p], 'volunteer.manageShifts')
);

describe('applyDutyListToProjectForm', () => {
	beforeEach(() => {
		signedIn = true;
		heldPositions = [];
		applyDutyList.mockReset();
		applyDutyList.mockResolvedValue({ workOrderIds: ['wo-1', 'wo-2'], taskCount: 3 });
	});

	it('stamps the list onto the project for a holder of volunteer.manageShifts', async () => {
		expect(holders.length).toBeGreaterThan(0);
		heldPositions = [holders[0]];

		await expect(applyDutyListToProjectForm(input)).resolves.toEqual({ workOrders: 2, tasks: 3 });
		expect(applyDutyList).toHaveBeenCalledWith('dl-1', { kind: 'project', id: PROJECT }, 'user-1');
	});

	it.each(others)('refuses %s, which does not hold volunteer.manageShifts', async (position) => {
		heldPositions = [position];
		await expect(applyDutyListToProjectForm(input)).rejects.toMatchObject({ status: 403 });
		expect(applyDutyList).not.toHaveBeenCalled();
	});

	it('refuses a signed-out caller', async () => {
		signedIn = false;
		await expect(applyDutyListToProjectForm(input)).rejects.toMatchObject({ status: 401 });
		expect(applyDutyList).not.toHaveBeenCalled();
	});
});
