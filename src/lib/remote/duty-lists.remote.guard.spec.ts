import { describe, it, expect, vi, beforeEach } from 'vitest';
import { grantsCapability, positions, type Capability } from '$lib/config';

/**
 * Project templates are read under `project.read` and edited under
 * `project.manage` (#2034), and every remote checks before it touches the
 * service. Applying from a show's console stays `volunteer.manageShifts`.
 */

const requireCapability = vi.fn<(cap: string) => Promise<unknown>>(async () => {
	throw new Error('403');
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	can: async () => false
}));

const service = vi.hoisted(() => ({
	addDutyListItem: vi.fn(),
	applyDutyList: vi.fn(),
	createDutyList: vi.fn(),
	deleteDutyList: vi.fn(),
	getDutyListDetail: vi.fn(),
	listDutyLists: vi.fn(),
	projectOfEvent: vi.fn(),
	removeDutyListItem: vi.fn(),
	setWorkTaskDone: vi.fn(),
	updateDutyList: vi.fn(),
	updateDutyListItem: vi.fn()
}));
vi.mock('$lib/server/volunteer/duty-list-service', () => service);
vi.mock('$lib/server/project/project-service', () => ({ listCommittees: vi.fn() }));
vi.mock('$lib/server/volunteer/volunteer-role-service', () => ({ listVolunteerRoles: vi.fn() }));
vi.mock('$lib/server/volunteer/work-order-service', () => ({ workOrderProjectId: vi.fn() }));
vi.mock('./volunteer.remote', () => ({
	getStaffShiftPage: vi.fn(),
	getVolunteerWorklist: vi.fn(),
	getWorkOrderActivity: vi.fn()
}));
vi.mock('./tasks.remote', () => ({ getProjectTaskPage: vi.fn() }));
vi.mock('./projects.remote', () => ({ getProjectActivity: vi.fn() }));
// Each wrapper carries `__`, which is how kit recognises a remote export.
vi.mock('$app/server', () => {
	const mark = (fn: unknown, type: string) =>
		Object.assign(fn as object, { __: { type }, for: () => fn });
	return {
		query: (...args: unknown[]) => mark(typeof args[0] === 'function' ? args[0] : args[1], 'query'),
		form: (_schema: unknown, handler: unknown) => mark(handler, 'form'),
		command: (handler: unknown) => mark(handler, 'command')
	};
});

const remote = (await import('./duty-lists.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const GATES: [string, string, unknown?][] = [
	['getDutyLists', 'project.read'],
	['getDutyListPage', 'project.read', 'tpl-1'],
	['createDutyList', 'project.manage', { name: 'x', anchor: 'start' }],
	['updateDutyList', 'project.manage', { id: 'tpl-1' }],
	['deleteDutyList', 'project.manage', { id: 'tpl-1' }],
	['addDutyListItem', 'project.manage', { dutyListId: 'tpl-1' }],
	['updateDutyListItem', 'project.manage', { id: 'i-1', dutyListId: 'tpl-1' }],
	['removeDutyListItem', 'project.manage', { id: 'i-1', dutyListId: 'tpl-1' }],
	['applyDutyList', 'volunteer.manageShifts', { dutyListId: 'tpl-1', eventId: 'e-1' }]
];

beforeEach(() => vi.clearAllMocks());

describe('project template remotes', () => {
	it.each(GATES)('%s is gated on %s and refuses before the service', async (name, cap, arg) => {
		await expect(remote[name](arg)).rejects.toThrow('403');
		expect(requireCapability).toHaveBeenCalledWith(cap);
		for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
	});
});

describe('the volunteer coordinator', () => {
	it.each(GATES)('holds what %s asks for (%s)', (_name, cap) => {
		expect(grantsCapability(positions.volunteer_coordinator, cap as Capability)).toBe(true);
	});
});
