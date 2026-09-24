import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';
import { groupJoinPolicies, positionOrder, type Capability, type Position } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// Pins which capability each `/staff/groups` export names, against the real
// matrix, so the table below shows who the swap from `requireStaff` moved.

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		return Object.assign((...a: unknown[]) => Promise.resolve(handler(...a)), {
			__: { type: 'query' }
		});
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } })
}));

let heldPositions: Position[] = ['staff'];
let signedIn = true;
const requested: string[] = [];
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('$lib/config');
	return {
		requireUser: () => ({ id: 'user-1' }),
		isElevated: vi.fn(async () => false),
		requireCapability: async (cap: Capability) => {
			requested.push(cap);
			if (!signedIn) throw error(401, 'Not authenticated');
			if (!heldPositions.some((p) => config.grantsCapability(config.positions[p], cap)))
				throw error(403, 'Not permitted');
			return { id: 'user-1' };
		}
	};
});

const svc = vi.hoisted(() => ({
	listGroups: vi.fn(),
	getGroupDetail: vi.fn(),
	createGroup: vi.fn(),
	updateGroupSettings: vi.fn(),
	assignLeader: vi.fn(),
	deactivate: vi.fn(),
	reactivate: vi.fn()
}));
vi.mock('$lib/server/group/group-service', () => ({
	STAFF_GROUP_KINDS: ['club', 'committee'],
	...svc,
	approveApplication: vi.fn(),
	declineApplication: vi.fn(),
	joinGroup: vi.fn(),
	leaveGroup: vi.fn(),
	getPublicGroup: vi.fn(),
	getUserGroupStatus: vi.fn(),
	listMemberGroups: vi.fn(),
	listPublicGroups: vi.fn(),
	updateGroupProfile: vi.fn()
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: vi.fn(),
	requireProgramRole: vi.fn()
}));
vi.mock('$lib/server/band/band-service', () => ({
	getMembers: vi.fn(async () => []),
	partitionByStatus: () => ({ active: [], pending: [], requested: [] }),
	acceptInvitation: vi.fn(),
	declineInvitation: vi.fn(),
	invite: vi.fn(),
	removeMember: vi.fn(),
	revokeInvitation: vi.fn(),
	searchMembers: vi.fn(),
	transferOwnership: vi.fn(),
	updateMember: vi.fn(),
	updateOwnMembership: vi.fn(),
	BandMemberExistsError: class extends Error {}
}));
vi.mock('$lib/server/group/group-invite-service', () => ({
	createInvite: vi.fn(),
	listForGroup: vi.fn(),
	listInvitesForEmail: vi.fn(),
	revoke: vi.fn()
}));
vi.mock('$lib/server/group/announcement-service', () => ({
	getMuteState: vi.fn(),
	listForManager: vi.fn(),
	listPublished: vi.fn()
}));
vi.mock('$lib/server/group/committee-application-service', () => ({ listForCommittee: vi.fn() }));
vi.mock('$lib/server/event/event-service', () => ({ listGroupSessions: vi.fn() }));
vi.mock('$lib/server/project/project-service', () => ({ listProjects: vi.fn() }));
vi.mock('$lib/server/volunteer/duty-list-service', () => ({ listDutyLists: vi.fn() }));
vi.mock('$lib/server/volunteer/volunteer-role-service', () => ({
	listVolunteerRoles: vi.fn(async () => [])
}));
vi.mock('$lib/server/group/file-service', () => ({ list: vi.fn(), getUsage: vi.fn() }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (v: unknown) => v }));
vi.mock('$lib/server/errors', () => ({
	mapDomainError: (err: unknown) => {
		throw err;
	}
}));
vi.mock('$lib/server/db/schema/directory', () => ({
	directoryVisibilities: ['hidden', 'members', 'public']
}));

const groups = (await import('./groups.remote')) as unknown as Record<
	string,
	(arg: unknown) => Promise<unknown>
>;

const settings = { joinPolicy: groupJoinPolicies[0], visibility: 'public' };
const EXPORTS = [
	['getStaffGroups', {}, 'group.read', svc.listGroups],
	['getStaffGroupPage', 'group-1', 'group.read', svc.getGroupDetail],
	[
		'createStaffGroup',
		{ kind: 'club', name: 'Book club', ...settings },
		'group.manage',
		svc.createGroup
	],
	[
		'updateStaffGroup',
		{ groupId: 'group-1', ...settings },
		'group.manage',
		svc.updateGroupSettings
	],
	['assignGroupLeader', { groupId: 'group-1', userId: 'user-9' }, 'group.manage', svc.assignLeader],
	['deactivateGroup', { groupId: 'group-1' }, 'group.manage', svc.deactivate],
	['reactivateGroup', { groupId: 'group-1' }, 'group.manage', svc.reactivate]
] as const;

const outcome = (name: string, input: unknown) =>
	groups[name](input).then(
		() => 'allowed' as const,
		(e: { status?: number }) => e.status ?? e
	);

beforeEach(() => {
	vi.clearAllMocks();
	heldPositions = ['staff'];
	signedIn = true;
	requested.length = 0;
	svc.getGroupDetail.mockResolvedValue({ id: 'group-1' });
	svc.createGroup.mockResolvedValue({ id: 'group-1', slug: 'book-club' });
});

// Every combination of the six positions, including none.
const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
	positionOrder.filter((_, i) => mask & (1 << i))
);

describe.each(EXPORTS)('%s', (name, input, cap, service) => {
	it(`names ${cap}`, async () => {
		await groups[name](input);
		expect(requested).toEqual([cap]);
	});

	it('refuses a signed-out caller with 401', async () => {
		signedIn = false;
		expect(await outcome(name, input)).toBe(401);
		expect(service).not.toHaveBeenCalled();
	});

	it('refuses a treasurer with 403, touching nothing', async () => {
		heldPositions = ['treasurer'];
		expect(await outcome(name, input)).toBe(403);
		expect(service).not.toHaveBeenCalled();
	});

	// Before: `requireStaff`, any position at all. After: only the holders of
	// `group.*`, which today are admin and staff. Every named position alone
	// loses this surface, as #1388 intends.
	it('admits exactly the admin or staff holders, where any position used to pass', async () => {
		const table = [];
		for (const held of subsets) {
			heldPositions = held;
			table.push({
				held: held.join('+') || '(none)',
				before: held.length > 0 ? 'allowed' : 403,
				after: await outcome(name, input)
			});
		}
		for (const row of table) {
			const holdsGroup = row.held.split('+').some((p) => p === 'admin' || p === 'staff');
			expect(row, row.held).toMatchObject({ after: holdsGroup ? 'allowed' : 403 });
		}
		const narrowed = table.filter((r) => r.before !== r.after).map((r) => r.held);
		expect(narrowed).toContain('treasurer');
		expect(narrowed).toContain(
			'technology_coordinator+volunteer_coordinator+site_moderator+treasurer'
		);
		expect(narrowed).toHaveLength(15);
	});
});
