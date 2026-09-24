import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';
import { positionOrder, type Capability, type Position } from '$lib/config';

// Applying a duty list to a project belongs to the committee that owns it, with
// `project.manage` as the staff cover. The fake guard reads the real matrix.

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
let committeeOf: string[] = [];
let signedIn = true;

async function holds(cap: Capability) {
	const config = await import('$lib/config');
	return heldPositions.some((p) => config.grantsCapability(config.positions[p], cap));
}

vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => {
			if (!signedIn) throw error(401, 'Not authenticated');
			return { id: 'user-1' };
		},
		can: holds,
		requireCapability: async (cap: Capability) => {
			if (!signedIn) throw error(401, 'Not authenticated');
			if (!(await holds(cap))) throw error(403, 'Not permitted');
			return { id: 'user-1' };
		}
	};
});

const requireCommitteeMember = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/group/group-context', () => ({ requireCommitteeMember }));

const applyDutyList = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/volunteer/duty-list-service', () => ({
	applyDutyList,
	listDutyLists: vi.fn(async () => [])
}));
const COMMITTEE = 'committee-1';
vi.mock('$lib/server/project/project-service', () => ({
	getProjectById: vi.fn(async (id: string) => ({ id, groupId: COMMITTEE }))
}));
vi.mock('$lib/remote/groups.remote', () => ({ getMemberGroup: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { applyDutyListToProjectForm } = (await import('./projects.remote')) as unknown as Record<
	string,
	(arg: unknown) => Promise<unknown>
>;

const PROJECT = '00000000-0000-4000-8000-000000000001';
const input = { projectId: PROJECT, dutyListId: 'dl-1' };

const { grantsCapability, positions } = await import('$lib/config');
const staffCover = positionOrder.filter((p) => grantsCapability(positions[p], 'project.manage'));
const others = positionOrder.filter((p) => !grantsCapability(positions[p], 'project.manage'));

describe('applyDutyListToProjectForm', () => {
	beforeEach(async () => {
		signedIn = true;
		heldPositions = [];
		committeeOf = [];
		applyDutyList.mockReset();
		applyDutyList.mockResolvedValue({ workOrderIds: ['wo-1', 'wo-2'], taskCount: 3 });
		const { error } = await import('@sveltejs/kit');
		requireCommitteeMember.mockReset();
		requireCommitteeMember.mockImplementation(async (groupId: string, cover: Capability) => {
			if (!signedIn) throw error(401, 'Not authenticated');
			if (committeeOf.includes(groupId))
				return { user: { id: 'user-1' }, group: null, role: 'member' };
			if (await holds(cover)) return { user: { id: 'user-1' }, group: null, role: 'staff' };
			throw error(403, 'Not a member of the committee that owns this');
		});
	});

	it('guards on the committee that owns the project, with project.manage as cover', async () => {
		committeeOf = [COMMITTEE];
		await applyDutyListToProjectForm(input);
		expect(requireCommitteeMember).toHaveBeenCalledWith(COMMITTEE, 'project.manage');
	});

	it('lets a member of the owning committee apply a list, holding no position', async () => {
		committeeOf = [COMMITTEE];

		await expect(applyDutyListToProjectForm(input)).resolves.toEqual({ workOrders: 2, tasks: 3 });
		expect(applyDutyList).toHaveBeenCalledWith('dl-1', { kind: 'project', id: PROJECT }, 'user-1');
	});

	it.each(staffCover)('lets %s apply a list as staff cover', async (position) => {
		heldPositions = [position];
		await expect(applyDutyListToProjectForm(input)).resolves.toEqual({ workOrders: 2, tasks: 3 });
	});

	it.each(others)('refuses %s outside the owning committee', async (position) => {
		heldPositions = [position];
		await expect(applyDutyListToProjectForm(input)).rejects.toMatchObject({ status: 403 });
		expect(applyDutyList).not.toHaveBeenCalled();
	});

	it('refuses the volunteer coordinator, who holds volunteer.manageShifts', async () => {
		heldPositions = ['volunteer_coordinator'];
		await expect(applyDutyListToProjectForm(input)).rejects.toMatchObject({ status: 403 });
	});

	it('refuses a member of a different committee', async () => {
		committeeOf = ['committee-2'];
		await expect(applyDutyListToProjectForm(input)).rejects.toMatchObject({ status: 403 });
		expect(applyDutyList).not.toHaveBeenCalled();
	});

	it('refuses a signed-out caller', async () => {
		signedIn = false;
		await expect(applyDutyListToProjectForm(input)).rejects.toMatchObject({ status: 401 });
		expect(applyDutyList).not.toHaveBeenCalled();
	});
});
