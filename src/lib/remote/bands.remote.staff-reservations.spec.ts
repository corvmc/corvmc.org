import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `getStaffBandReservations` was called `getBandReservations` until #618, the
 * same name as the band-context query in `reservations.remote.ts`. That one
 * admits the band's own members (`requireGroupRole(..., 'member')`); this one
 * is staff-only and keyed by id. What is pinned here is that the staff guard
 * stays the narrower of the two — a capability check with no membership
 * fallback underneath it.
 */

const can = vi.fn(async (_cap: string) => true);
let currentUser: { id: string } | null = { id: 'staff-1' };

vi.mock('$lib/server/authorization', () => ({
	requireCapability: async (cap: string) => {
		const { error } = await import('@sveltejs/kit');
		if (!currentUser) throw error(401, 'Not authenticated');
		if (!(await can(cap))) throw error(403, 'Not permitted');
		return currentUser;
	},
	requireUser: () => {
		if (!currentUser) throw new Error('unauthenticated');
		return currentUser;
	},
	isElevated: vi.fn(async () => false),
	hasAnyRole: vi.fn(async () => false)
}));

// Mocked so a membership fallback would be observable: if this query ever grows
// one, `requireGroupRole` records the call and the test below fails.
const requireGroupRole = vi.fn(async () => ({
	user: currentUser,
	group: { id: 'band-1', slug: 'the-velvet-underground', kind: 'band' },
	role: 'owner'
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole,
	requireBandRole: requireGroupRole,
	requireProgramRole: requireGroupRole
}));

vi.mock('$lib/server/band/band-service', () => ({
	listAll: vi.fn(async () => []),
	listForUser: vi.fn(async () => []),
	getByIdWithDetails: vi.fn(async () => ({ id: 'band-1', name: 'The Velvet Underground' })),
	getMembers: vi.fn(async () => []),
	partitionByStatus: (rows: unknown[]) => ({ pending: [], active: rows, requested: [] }),
	getBySlug: vi.fn(async () => null),
	getByIdActive: vi.fn(async () => null),
	searchMembers: vi.fn(async () => []),
	update: vi.fn(),
	updateMember: vi.fn(),
	updateOwnMembership: vi.fn(),
	create: vi.fn(),
	acceptInvitation: vi.fn(),
	declineInvitation: vi.fn(),
	invite: vi.fn(),
	removeMember: vi.fn(),
	revokeInvitation: vi.fn(),
	transferOwnership: vi.fn(),
	leaveBand: vi.fn(),
	deleteBand: vi.fn(),
	deactivate: vi.fn(),
	reactivate: vi.fn(),
	setTier: vi.fn(),
	// `mapDomainError` builds its `instanceof` ladder from this module's exports,
	// so every class the ladder names has to exist here or it compares against
	// `undefined` and throws instead of mapping.
	BandMemberExistsError: class BandMemberExistsError extends Error {},
	CannotRemoveOwnerError: class CannotRemoveOwnerError extends Error {},
	OwnerCannotLeaveError: class OwnerCannotLeaveError extends Error {},
	BandNotFoundError: class BandNotFoundError extends Error {},
	BandTierManagedByStripeError: class BandTierManagedByStripeError extends Error {}
}));

vi.mock('$lib/server/group/group-invite-service', () => ({
	createInvite: vi.fn(),
	listForGroup: vi.fn(async () => []),
	revoke: vi.fn()
}));

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

vi.mock('$lib/server/db', () => ({ db: { select: () => chainable() } }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: currentUser },
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(handler as any).__ = { type: 'query' };
		return handler;
	}
}));

const { getStaffBandReservations, getStaffBandPage } = (await import('./bands.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = { id: 'staff-1' };
	can.mockResolvedValue(true);
	requireGroupRole.mockClear();
	selectResult = [];
});

describe('getStaffBandReservations', () => {
	it('reads the band by id for a caller holding band.read', async () => {
		selectResult = [{ id: 'res-1', status: 'confirmed', bookedByName: 'Lou Reed' }];

		await expect(getStaffBandReservations('band-1')).resolves.toHaveLength(1);
		expect(can).toHaveBeenCalledWith('band.read');
	});

	it('refuses a signed-in caller without band.read', async () => {
		can.mockResolvedValue(false);

		await expect(getStaffBandReservations('band-1')).rejects.toMatchObject({ status: 403 });
	});

	it('refuses an unauthenticated caller', async () => {
		currentUser = null;

		await expect(getStaffBandReservations('band-1')).rejects.toMatchObject({ status: 401 });
	});

	/**
	 * The point of the rename. Widening this to the band's own members would
	 * hand every bandmate the staff projection, so the capability check must be
	 * the only door — no `requireGroupRole` fallback beneath it.
	 */
	it('never falls back to a band-membership check', async () => {
		can.mockResolvedValue(false);

		await expect(getStaffBandReservations('band-1')).rejects.toMatchObject({ status: 403 });
		expect(requireGroupRole).not.toHaveBeenCalled();
	});
});

describe('getStaffBandPage', () => {
	// The only caller. It composes the staff-keyed read, not the member one.
	it('refuses wholesale when the caller lacks band.read', async () => {
		can.mockResolvedValue(false);

		await expect(getStaffBandPage('band-1')).rejects.toMatchObject({ status: 403 });
		expect(requireGroupRole).not.toHaveBeenCalled();
	});
});
