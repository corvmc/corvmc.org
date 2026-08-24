import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBand = {
	id: 'band-1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	bio: 'NYC band',
	ownerId: 'user-owner',
	avatarKey: null,
	memberCount: 3,
	createdAt: new Date(),
	updatedAt: new Date()
};

const bandServiceMock = {
	getBySlug: vi.fn(async () => mockBand),
	getUserRole: vi.fn(async () => 'owner' as string | null),
	searchMembers: vi.fn(async () => [{ id: 'user-3', name: 'Lou Reed', email: 'lou@example.com' }]),
	getMembers: vi.fn(async () => []),
	invite: vi.fn(async () => ({
		id: 'member-new',
		bandId: 'band-1',
		userId: 'user-3',
		role: 'member',
		status: 'pending',
		position: 'Guitar',
		invitedById: 'user-owner',
		createdAt: new Date()
	})),
	removeMember: vi.fn(async () => ({ rowCount: 1 })),
	revokeInvitation: vi.fn(async () => ({ rowCount: 1 })),
	updateMember: vi.fn(
		async (
			_memberId: string,
			_data: { role?: string; position?: string | null },
			_bandId?: string
		) => undefined
	),
	updateOwnMembership: vi.fn(async () => undefined),
	transferOwnership: vi.fn(async () => undefined),
	leaveBand: vi.fn(async () => ({ rowCount: 1 })),
	// `mapDomainError` builds its `instanceof` ladder from this module's exports.
	// With the module mocked they must be here, or the ladder compares against
	// `undefined` and throws a TypeError instead of mapping the status. Same
	// shape as the real ones — plain Error subclasses, matched by identity.
	CannotRemoveOwnerError: class CannotRemoveOwnerError extends Error {},
	OwnerCannotLeaveError: class OwnerCannotLeaveError extends Error {},
	BandMemberExistsError: class BandMemberExistsError extends Error {},
	BandNotFoundError: class BandNotFoundError extends Error {},
	BandTierManagedByStripeError: class BandTierManagedByStripeError extends Error {}
};

vi.mock('$lib/server/band/band-service', () => bandServiceMock);

const testUser = mockUser({ id: 'user-owner', name: 'Test Owner' });

vi.mock('$lib/server/authorization', () => ({
	hasAnyRole: vi.fn(async () => false),
	requireUser: () => testUser
}));

// Mock DB for page load
let selectResult: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable()
	}
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		params: { slug: 'the-velvet-underground' },
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: unknown[]) => {
		// query can be (schema, handler) or (handler)
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...args: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

const {
	inviteMember,
	removeMember,
	revokeInvitation,
	updateMemberRemote,
	transferOwner,
	leave,
	updateMyBandMembership,
	searchBandUsers: searchUsers
} = (await import('$lib/remote/bands.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	bandServiceMock.getUserRole.mockResolvedValue('owner');
	selectResult = [];
});

// ---------------------------------------------------------------------------
// Remote form handlers
// ---------------------------------------------------------------------------

describe('inviteMember', () => {
	it('calls invite with correct params', async () => {
		const result = await inviteMember({
			userId: 'user-3',
			role: 'member',
			position: 'Guitar'
		});

		expect(bandServiceMock.invite).toHaveBeenCalledWith(
			'band-1',
			'user-3',
			'member',
			'Guitar',
			'user-owner'
		);
		expect(result.success).toBe(true);
	});

	it('sends null position when empty', async () => {
		await inviteMember({ userId: 'user-3', role: 'admin', position: '' });

		expect(bandServiceMock.invite).toHaveBeenCalledWith(
			'band-1',
			'user-3',
			'admin',
			null,
			'user-owner'
		);
	});
});

// The memberId comes from the client, so these forms must scope the service
// call to the slug's band (cross-band IDOR regression).
describe('removeMember', () => {
	it('calls removeMember scoped to the current band', async () => {
		const result = await removeMember({ memberId: 'member-42' });

		expect(bandServiceMock.removeMember).toHaveBeenCalledWith('member-42', 'band-1');
		expect(result.success).toBe(true);
	});
});

describe('revokeInvitation', () => {
	it('calls revokeInvitation scoped to the current band', async () => {
		const result = await revokeInvitation({ memberId: 'member-42' });

		expect(bandServiceMock.revokeInvitation).toHaveBeenCalledWith('member-42', 'band-1');
		expect(result.success).toBe(true);
	});
});

describe('updateMemberRemote', () => {
	it('calls updateMember with role and position scoped to the current band', async () => {
		const result = await updateMemberRemote({
			memberId: 'member-42',
			role: 'admin',
			position: 'Bass'
		});

		expect(bandServiceMock.updateMember).toHaveBeenCalledWith(
			'member-42',
			{
				role: 'admin',
				position: 'Bass'
			},
			'band-1'
		);
		expect(result.success).toBe(true);
	});
});

describe('transferOwner', () => {
	it('calls transferOwnership with correct params', async () => {
		const result = await transferOwner({ newOwnerId: 'user-3' });

		expect(bandServiceMock.transferOwnership).toHaveBeenCalledWith(
			'band-1',
			'user-3',
			'user-owner'
		);
		expect(result.success).toBe(true);
	});
});

describe('leave', () => {
	it('calls leaveBand with band and user id', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('member');

		const result = await leave({});

		expect(bandServiceMock.leaveBand).toHaveBeenCalledWith('band-1', 'user-owner');
		expect(result.success).toBe(true);
	});

	// This used to guard with `requireBandBySlug()` + `requireUser()` rather than
	// `requireBandMember()`, so a non-member's submission reached the service and
	// surfaced its plain Error as a 500 — a generic toast for what is a 403.
	it('refuses a non-member with 403, not a 500', async () => {
		bandServiceMock.getUserRole.mockResolvedValue(null);

		await expect(leave({})).rejects.toMatchObject({ status: 403 });
		expect(bandServiceMock.leaveBand).not.toHaveBeenCalled();
	});

	// `OwnerCannotLeaveError` already maps to 422, but nothing routed the service
	// call through `mapDomainError`, so an owner got a 500 and a generic toast.
	it('maps the owner-cannot-leave rule to 422', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('owner');
		bandServiceMock.leaveBand.mockRejectedValueOnce(
			new bandServiceMock.OwnerCannotLeaveError('Owner cannot leave the band')
		);

		await expect(leave({})).rejects.toMatchObject({ status: 422 });
	});
});

describe('searchUsers', () => {
	it('returns matching users', async () => {
		const results = await searchUsers('lou');

		expect(bandServiceMock.searchMembers).toHaveBeenCalledWith('lou', 'band-1');
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Lou Reed');
	});

	it('returns empty for short queries', async () => {
		const results = await searchUsers('l');

		expect(bandServiceMock.searchMembers).not.toHaveBeenCalled();
		expect(results).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Self-service membership
//
// `position` had been settable only at invite time since bands shipped, and
// `alias` is new. Both belong to the person they describe, so they get their
// own remote rather than an arm of the admin one.
// ---------------------------------------------------------------------------

describe('updateMyBandMembership', () => {
	beforeEach(() => {
		bandServiceMock.getUserRole.mockResolvedValue('member');
	});

	it("writes the caller's own row, resolved from the guard", async () => {
		await updateMyBandMembership({ alias: 'Ziggy', position: 'Bass' });

		expect(bandServiceMock.updateOwnMembership).toHaveBeenCalledWith('band-1', 'user-owner', {
			alias: 'Ziggy',
			position: 'Bass'
		});
	});

	// The schema has no memberId at all — the row comes from (band.id, user.id),
	// which is unique. Keying a mutation on a caller-supplied id when the guard
	// already knows the row is how one member ends up editing another.
	it('ignores any submitted member id', async () => {
		await updateMyBandMembership({ alias: 'Ziggy', memberId: 'member-someone-else' });

		expect(bandServiceMock.updateOwnMembership).toHaveBeenCalledWith(
			'band-1',
			'user-owner',
			expect.objectContaining({ alias: 'Ziggy' })
		);
		expect(bandServiceMock.updateMember).not.toHaveBeenCalled();
	});

	// `updateMember` throws CannotRemoveOwnerError on any owner row — that guard
	// exists to stop an admin demoting the owner, and routing self-service
	// through it would lock the owner out of their own stage name.
	it('lets an owner set their own alias', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('owner');

		await expect(updateMyBandMembership({ alias: 'Ziggy' })).resolves.toEqual({ success: true });
		expect(bandServiceMock.updateOwnMembership).toHaveBeenCalled();
	});

	it('clears the alias when submitted empty, rather than skipping it', async () => {
		await updateMyBandMembership({ alias: '', position: '' });

		expect(bandServiceMock.updateOwnMembership).toHaveBeenCalledWith('band-1', 'user-owner', {
			alias: null,
			position: null
		});
	});

	it('refuses a non-member', async () => {
		bandServiceMock.getUserRole.mockResolvedValue(null);

		await expect(updateMyBandMembership({ alias: 'Ziggy' })).rejects.toMatchObject({ status: 403 });
	});
});

describe('updateMemberRemote', () => {
	// An admin can say what you play; they cannot rename you. `alias` is absent
	// from this schema, so a submitted one is dropped rather than written.
	it('never writes an alias, even if one is submitted', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');

		await updateMemberRemote({ memberId: 'member-2', position: 'Drums', alias: 'Not Yours' });

		const written = bandServiceMock.updateMember.mock.calls[0]![1];
		expect(written).not.toHaveProperty('alias');
		expect(written.position).toBe('Drums');
	});
});
