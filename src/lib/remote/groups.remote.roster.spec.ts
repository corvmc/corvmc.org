import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// The roster writes are `band-service`'s and were already generic. What this
// suite pins is the part that is new: which guard each remote goes through, at
// which floor, and that every id the client sends is scoped to the group the
// guard resolved rather than taken on trust.

class ValidationFailure extends Error {
	constructor(readonly issues: z.core.$ZodIssue[]) {
		super('validation failed');
	}
}

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		const wrapped = (...a: unknown[]) => {
			const promise = Promise.resolve(handler(...a)) as Promise<unknown> & { refresh(): void };
			promise.refresh = () => {};
			return promise;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) => {
		const fn = async (raw: unknown) => {
			const parsed = schema.safeParse(raw);
			if (!parsed.success) throw new ValidationFailure(parsed.error.issues);
			return handler(parsed.data, {});
		};
		const marked = fn as unknown as Record<string, unknown>;
		marked.__ = { type: 'form' };
		marked.for = () => fn;
		return fn;
	}
}));

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'user-1' }),
	requireStaff: vi.fn(async () => ({ id: 'staff-1' })),
	isElevated: vi.fn(async () => false)
}));

/**
 * Faithful to the real guards: resolve the group from the ref, 404 an unknown
 * slug, 404 a band under a program guard, 403 below the floor.
 */
const GROUPS: Record<string, { id: string; slug: string; kind: string }> = {
	'real-book-club': { id: 'group-1', slug: 'real-book-club', kind: 'club' },
	'wren-halloway': { id: 'band-1', slug: 'wren-halloway', kind: 'band' }
};
const RANK = { owner: 0, admin: 1, member: 2 } as const;
let callerRole: 'owner' | 'admin' | 'member' = 'admin';

const httpError = (status: number, message: string) =>
	Object.assign(new Error(message), { status, body: { message } });

const requireGroupRole = vi.fn(
	async (ref: { slug?: string; id?: string }, minRole: 'owner' | 'admin' | 'member') => {
		const group = ref.slug ? GROUPS[ref.slug] : Object.values(GROUPS).find((g) => g.id === ref.id);
		if (!group) throw httpError(404, 'Group not found');
		if (RANK[callerRole] > RANK[minRole]) throw httpError(403, 'Insufficient permissions');
		return { user: { id: 'user-1' }, group, role: callerRole };
	}
);
const requireProgramRole = vi.fn(
	async (ref: { slug?: string; id?: string }, minRole: 'owner' | 'admin' | 'member') => {
		const ctx = await requireGroupRole(ref, minRole);
		if (ctx.group.kind === 'band') throw httpError(404, 'Group not found');
		return ctx;
	}
);
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) =>
		requireGroupRole(...(a as Parameters<typeof requireGroupRole>)),
	requireProgramRole: (...a: unknown[]) =>
		requireProgramRole(...(a as Parameters<typeof requireProgramRole>))
}));

const band = {
	invite: vi.fn(async () => ({ id: 'member-new' })),
	removeMember: vi.fn(async () => undefined),
	revokeInvitation: vi.fn(async () => undefined),
	updateMember: vi.fn(async () => undefined),
	transferOwnership: vi.fn(async () => undefined),
	searchMembers: vi.fn(async () => [{ id: 'user-9', name: 'Nine', email: 'nine@example.com' }]),
	acceptInvitation: vi.fn(async () => ({ status: 'active' as string })),
	declineInvitation: vi.fn(async () => true)
};
// Declared inside the factory: `vi.mock` is hoisted above every top-level
// statement, so a class defined out here is not yet initialized when it runs.
const { BandMemberExistsError } = vi.hoisted(() => ({
	BandMemberExistsError: class BandMemberExistsError extends Error {}
}));
vi.mock('$lib/server/band/band-service', () => ({
	getMembers: vi.fn(async () => []),
	partitionByStatus: () => ({ active: [], pending: [], requested: [] }),
	invite: (...a: unknown[]) => band.invite(...(a as [])),
	removeMember: (...a: unknown[]) => band.removeMember(...(a as [])),
	revokeInvitation: (...a: unknown[]) => band.revokeInvitation(...(a as [])),
	updateMember: (...a: unknown[]) => band.updateMember(...(a as [])),
	transferOwnership: (...a: unknown[]) => band.transferOwnership(...(a as [])),
	searchMembers: (...a: unknown[]) => band.searchMembers(...(a as [])),
	acceptInvitation: (...a: unknown[]) => band.acceptInvitation(...(a as [])),
	declineInvitation: (...a: unknown[]) => band.declineInvitation(...(a as [])),
	BandMemberExistsError
}));

const invites = {
	createInvite: vi.fn(async () => ({ type: 'group_invite' as const, id: 'invite-1' })),
	listForGroup: vi.fn(async () => []),
	revoke: vi.fn(async () => undefined)
};
vi.mock('$lib/server/group/group-invite-service', () => ({
	createInvite: (...a: unknown[]) => invites.createInvite(...(a as [])),
	listForGroup: (...a: unknown[]) => invites.listForGroup(...(a as [])),
	revoke: (...a: unknown[]) => invites.revoke(...(a as []))
}));

vi.mock('$lib/server/group/group-service', () => ({
	STAFF_GROUP_KINDS: ['club', 'committee'],
	assignLeader: vi.fn(),
	createGroup: vi.fn(),
	deactivate: vi.fn(),
	approveApplication: vi.fn(),
	declineApplication: vi.fn(),
	getGroupDetail: vi.fn(),
	joinGroup: vi.fn(),
	leaveGroup: vi.fn(),
	getPublicGroup: vi.fn(),
	getUserGroupStatus: vi.fn(),
	listGroups: vi.fn(),
	listMemberGroups: vi.fn(),
	listPublicGroups: vi.fn(),
	reactivate: vi.fn(),
	updateGroupProfile: vi.fn(),
	updateGroupSettings: vi.fn()
}));
vi.mock('$lib/server/group/announcement-service', () => ({
	getMuteState: vi.fn(),
	listForManager: vi.fn(),
	listPublished: vi.fn()
}));
vi.mock('$lib/server/event/event-service', () => ({ listGroupSessions: vi.fn() }));
vi.mock('$lib/server/project/project-service', () => ({ listProjects: vi.fn() }));
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

// Cast, as the sibling remote specs do: the mocked `form()` returns a plain
// function, but the module's declared type is `RemoteForm`, which is not
// callable.
const groups = (await import('./groups.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const statusOf = async (fn: () => Promise<unknown>) => {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status ?? 0;
	}
	throw new Error('expected a throw');
};

beforeEach(() => {
	vi.clearAllMocks();
	callerRole = 'admin';
	band.acceptInvitation.mockResolvedValue({ status: 'active' });
	band.declineInvitation.mockResolvedValue(true);
	band.searchMembers.mockResolvedValue([{ id: 'user-9', name: 'Nine', email: 'nine@example.com' }]);
	invites.createInvite.mockResolvedValue({ type: 'group_invite', id: 'invite-1' });
});

const SLUG = 'real-book-club';

describe('the roster writes a leader reaches', () => {
	/**
	 * Every one of these takes a `memberId` or an `inviteId` from the client. The
	 * group they are scoped to must come from the guard instead, or a leader of
	 * one program could act on another's row.
	 */
	it.each([
		[
			'removeGroupMember',
			() => groups.removeGroupMember({ slug: SLUG, memberId: 'member-7' }),
			() => expect(band.removeMember).toHaveBeenCalledWith('member-7', 'group-1')
		],
		[
			'revokeGroupInvitation',
			() => groups.revokeGroupInvitation({ slug: SLUG, memberId: 'member-7' }),
			() => expect(band.revokeInvitation).toHaveBeenCalledWith('member-7', 'group-1')
		],
		[
			'revokeGroupEmailInvite',
			() => groups.revokeGroupEmailInvite({ slug: SLUG, inviteId: 'invite-7' }),
			() => expect(invites.revoke).toHaveBeenCalledWith('invite-7', 'group-1')
		],
		[
			'updateGroupMember',
			() => groups.updateGroupMember({ slug: SLUG, memberId: 'member-7', role: 'admin' }),
			() =>
				expect(band.updateMember).toHaveBeenCalledWith(
					'member-7',
					expect.objectContaining({ role: 'admin' }),
					'group-1'
				)
		]
	])('%s scopes the id to the resolved group', async (_name, call, assertScope) => {
		await call();
		assertScope();
	});

	it('invites through the resolved group, with the caller as inviter', async () => {
		await groups.inviteGroupMember({ slug: SLUG, userId: 'user-9', role: 'member', position: '' });
		expect(band.invite).toHaveBeenCalledWith('group-1', 'user-9', 'member', null, 'user-1');
	});

	it('reports an already-invited address as a field issue, not a throw', async () => {
		invites.createInvite.mockRejectedValue(new BandMemberExistsError('Already invited.'));
		// `invalid()` throws its own control-flow error; what matters is that it is
		// not the domain error reaching the client as a 500.
		await expect(
			groups.inviteGroupByEmail({
				slug: SLUG,
				email: 'them@example.com',
				role: 'member',
				position: ''
			})
		).rejects.not.toBeInstanceOf(BandMemberExistsError);
	});

	it.each([
		['removeGroupMember', () => groups.removeGroupMember({ slug: SLUG, memberId: 'm' })],
		['updateGroupMember', () => groups.updateGroupMember({ slug: SLUG, memberId: 'm' })],
		[
			'inviteGroupMember',
			() => groups.inviteGroupMember({ slug: SLUG, userId: 'u', role: 'member', position: '' })
		],
		['searchGroupUsers', () => groups.searchGroupUsers({ slug: SLUG, q: 'nine' })]
	])('%s refuses a plain member', async (_name, call) => {
		callerRole = 'member';
		expect(await statusOf(call)).toBe(403);
	});

	/** A band has `/band/{slug}/members`; these must not serve one. */
	it.each([
		['removeGroupMember', () => groups.removeGroupMember({ slug: 'wren-halloway', memberId: 'm' })],
		[
			'inviteGroupMember',
			() =>
				groups.inviteGroupMember({
					slug: 'wren-halloway',
					userId: 'u',
					role: 'member',
					position: ''
				})
		],
		['searchGroupUsers', () => groups.searchGroupUsers({ slug: 'wren-halloway', q: 'nine' })]
	])('%s 404s a band slug', async (_name, call) => {
		expect(await statusOf(call)).toBe(404);
	});
});

describe('transferGroupOwner', () => {
	/**
	 * Owner, not admin: an admin promoting themselves would be the whole of the
	 * escalation. Staff move the seat over a leader's head through
	 * `assignGroupLeader` instead.
	 */
	it('is owner-only', async () => {
		callerRole = 'admin';
		expect(
			await statusOf(() => groups.transferGroupOwner({ slug: SLUG, newOwnerId: 'user-9' }))
		).toBe(403);
	});

	it('hands the seat on, naming the outgoing owner as the actor', async () => {
		callerRole = 'owner';
		await groups.transferGroupOwner({ slug: SLUG, newOwnerId: 'user-9' });
		expect(band.transferOwnership).toHaveBeenCalledWith('group-1', 'user-9', 'user-1');
	});
});

describe('answering an invitation', () => {
	/**
	 * `requireUser`, not `requireGroupRole`: the caller's row is `pending`, which
	 * resolves no role at all. The service scopes the write to `(groupId,
	 * userId)`, so naming somebody else's group finds nothing to accept.
	 */
	it('accepts on the caller‑s own row', async () => {
		await groups.acceptGroupInvite({ groupId: 'group-1' });
		expect(band.acceptInvitation).toHaveBeenCalledWith('group-1', 'user-1');
		expect(requireGroupRole).not.toHaveBeenCalled();
		expect(requireProgramRole).not.toHaveBeenCalled();
	});

	/**
	 * A revoked or already-answered invitation is an ordinary state. Thrown, it
	 * would reach Sentry as a 500 and show the member a generic toast.
	 */
	it('reports a vanished invitation in-band rather than throwing', async () => {
		band.acceptInvitation.mockResolvedValue({ status: 'not_found' });
		await expect(groups.acceptGroupInvite({ groupId: 'group-1' })).resolves.toEqual({
			success: false,
			reason: 'not_found'
		});
	});

	it('declines, and reports a vanished invitation the same way', async () => {
		await expect(groups.declineGroupInvite({ groupId: 'group-1' })).resolves.toEqual({
			success: true
		});
		band.declineInvitation.mockResolvedValue(false);
		await expect(groups.declineGroupInvite({ groupId: 'group-1' })).resolves.toEqual({
			success: false,
			reason: 'not_found'
		});
	});
});
