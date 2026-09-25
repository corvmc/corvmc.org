import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1512: a committee keeps its own recurring work. The guard is
// requireCommitteeMember, and retiring reads the owning committee from the
// schedule's row, never from what the client posted.

let member = true;
const requireCommitteeMember = vi.fn(async (groupId: string | null, cover: string) => {
	if (!member) throw new Error(`403: ${cover}`);
	return {
		user: { id: 'u-1' },
		group: groupId ? { id: groupId, slug: 'booking', kind: 'committee' } : null,
		role: 'member'
	};
});
vi.mock('$lib/server/group/group-context', () => ({ requireCommitteeMember }));
vi.mock('$lib/server/authorization', () => ({ requireCapability: vi.fn() }));

const createService = vi.fn(async () => ({ id: 'ms-1' }));
const retireService = vi.fn(async () => undefined);
const getScheduleGroupId = vi.fn(async () => 'grp-own');
vi.mock('$lib/server/volunteer/maintenance-schedule-service', () => ({
	createMaintenanceSchedule: createService,
	listMaintenanceSchedules: vi.fn(async () => []),
	retireMaintenanceSchedule: retireService,
	getScheduleGroupId
}));

vi.mock('$lib/server/volunteer/volunteer-role-service', () => ({ listVolunteerRoles: vi.fn() }));
vi.mock('$lib/server/project/project-service', () => ({ listProjects: vi.fn() }));
vi.mock('./volunteer.remote', () => ({
	getVolunteerWorklist: () => ({ refresh: async () => undefined })
}));
vi.mock('./groups.remote', () => ({
	getMemberGroup: () => ({ refresh: async () => undefined })
}));

vi.mock('$app/server', () => {
	// The last argument is the handler, called directly; `__` is what SvelteKit
	// checks to accept the export as a remote function. A query call is lazy.
	const tag = (args: unknown[], type: string) => {
		const handler = args[args.length - 1] as (...a: unknown[]) => unknown;
		const call = (...a: unknown[]) =>
			type === 'query'
				? {
						then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
							Promise.resolve()
								.then(() => handler(...a))
								.then(res, rej),
						refresh: async () => undefined
					}
				: handler(...a);
		return Object.assign(call, { __: { type } });
	};
	return {
		query: (...a: unknown[]) => tag(a, 'query'),
		form: (...a: unknown[]) => tag(a, 'form'),
		command: (...a: unknown[]) => tag(a, 'command')
	};
});

const remote = await import('./maintenance-schedules.remote');
// The mock above makes a form a plain function; its declared type has no call signature.
const create = remote.createCommitteeRecurringWork as unknown as (d: unknown) => Promise<unknown>;
const retire = remote.retireCommitteeRecurringWork as unknown as (d: unknown) => Promise<unknown>;

beforeEach(() => {
	member = true;
	vi.clearAllMocks();
});

const input = {
	groupId: 'grp-own',
	name: 'Weekly holds review',
	volunteerRoleId: 'role-1',
	intervalDays: '7',
	firstDueOn: '2026-10-01'
};

describe('createCommitteeRecurringWork', () => {
	it('guards on the committee with volunteer.manageRecurring as the staff cover', async () => {
		await create(input);
		expect(requireCommitteeMember).toHaveBeenCalledWith('grp-own', 'volunteer.manageRecurring');
		expect(createService).toHaveBeenCalledWith(
			expect.objectContaining({ groupId: 'grp-own', createdByUserId: 'u-1' })
		);
	});

	it('refuses somebody off the committee before writing', async () => {
		member = false;
		await expect(create(input)).rejects.toThrow(/403/);
		expect(createService).not.toHaveBeenCalled();
	});
});

describe('retireCommitteeRecurringWork', () => {
	it("guards on the schedule's own committee", async () => {
		await retire({ id: 'ms-1' });
		expect(getScheduleGroupId).toHaveBeenCalledWith('ms-1');
		expect(requireCommitteeMember).toHaveBeenCalledWith('grp-own', 'volunteer.manageRecurring');
		expect(retireService).toHaveBeenCalledWith('ms-1');
	});

	it('refuses somebody off that committee before retiring', async () => {
		member = false;
		await expect(retire({ id: 'ms-1' })).rejects.toThrow(/403/);
		expect(retireService).not.toHaveBeenCalled();
	});
});
