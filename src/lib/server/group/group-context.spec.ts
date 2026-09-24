import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const requireUser = vi.fn(() => ({ id: 'user-1' }));
// Both, so a test can tell them apart: `isElevated` is any position-holder and
// `hasAnyRole(['admin','staff'])` is the two literal role rows. The guard must
// use the first, matching `requireStaff()`.
const isElevated = vi.fn(async () => false);
const hasAnyRole = vi.fn(async () => false);
const can = vi.fn(async () => false);
const listUsersWithCapability = vi.fn(
	async (_cap?: unknown): Promise<Array<{ id: string; name: string; email: string }>> => []
);
vi.mock('$lib/server/authorization', () => ({
	listUsersWithCapability: (cap: unknown) => listUsersWithCapability(cap),
	requireUser: () => requireUser(),
	isElevated: (...a: unknown[]) => isElevated(...(a as [])),
	hasAnyRole: (...a: unknown[]) => hasAnyRole(...(a as [])),
	can: (...a: unknown[]) => can(...(a as []))
}));

// Typed with their parameters so the D1-rejecting overrides below are
// assignable; a zero-arg `vi.fn` narrows the mock to `() => …` and rejects it.
const getBySlug = vi.fn(async (_slug: unknown) => null as unknown);
const getByIdActive = vi.fn(async (_id: unknown) => null as unknown);
const getUserRole = vi.fn(async () => null as unknown);
const listActiveMembers = vi.fn(async (_id: unknown) => [] as unknown[]);
vi.mock('$lib/server/band/band-service', () => ({
	listActiveMembers: (id: unknown) => listActiveMembers(id),
	getBySlug: (slug: unknown) => getBySlug(slug),
	getByIdActive: (id: unknown) => getByIdActive(id),
	getUserRole: (...a: unknown[]) => getUserRole(...(a as []))
}));

import { COMMITTEE_IDS } from '$lib/config';
import {
	committeeCapabilitiesFor,
	listCapabilityHolders,
	listCommitteeHolders,
	requireBandRole,
	requireCommitteeCapability,
	requireCommitteeMember,
	requireCommitteeReviewer,
	requireGroupRole,
	requireProgramRole
} from './group-context';

const GROUP = { id: 'group-1', slug: 'our-band', name: 'Our Band', kind: 'band' };
const CLUB = { id: 'group-2', slug: 'real-book-club', name: 'Real Book Club', kind: 'club' };

beforeEach(() => {
	for (const m of [
		getBySlug,
		getByIdActive,
		getUserRole,
		listActiveMembers,
		isElevated,
		hasAnyRole,
		can
	])
		m.mockReset();
	getBySlug.mockResolvedValue(null);
	getByIdActive.mockResolvedValue(null);
	getUserRole.mockResolvedValue(null);
	listActiveMembers.mockResolvedValue([]);
	isElevated.mockResolvedValue(false);
	can.mockResolvedValue(false);
	hasAnyRole.mockResolvedValue(false);
});

/** Pull the status off a thrown kit `HttpError` without depending on its class. */
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status ?? 0;
	}
	throw new Error('expected the guard to throw, but it resolved');
}

describe('requireGroupRole', () => {
	describe('resolving the ref', () => {
		it('resolves a slug ref through getBySlug', async () => {
			getBySlug.mockResolvedValue(GROUP);
			getUserRole.mockResolvedValue('member');

			await expect(requireGroupRole({ slug: 'our-band' }, 'member')).resolves.toEqual({
				user: { id: 'user-1' },
				group: GROUP,
				role: 'member'
			});
			expect(getBySlug).toHaveBeenCalledWith('our-band');
			expect(getByIdActive).not.toHaveBeenCalled();
		});

		/**
		 * `getByIdActive`, not `getById`: the latter is a bare row read that does
		 * not exclude soft-deleted groups, and a guard must not resolve one.
		 */
		it('resolves an id ref through getByIdActive', async () => {
			getByIdActive.mockResolvedValue(GROUP);
			getUserRole.mockResolvedValue('admin');

			const ctx = await requireGroupRole({ id: 'group-1' }, 'admin');
			expect(ctx.group).toEqual(GROUP);
			expect(getByIdActive).toHaveBeenCalledWith('group-1');
			expect(getBySlug).not.toHaveBeenCalled();
		});

		it.each([
			['slug', { slug: 'no-such-group' }],
			['id', { id: 'no-such-group' }]
		])('404s an unresolvable %s ref', async (_name, ref) => {
			expect(await statusOf(() => requireGroupRole(ref, 'member'))).toBe(404);
			expect(getUserRole).not.toHaveBeenCalled();
		});

		it('404s a soft-deleted group, because the lookup filters it out', async () => {
			// `getBySlug` already excludes `deletedAt`; the guard inherits that
			// rather than re-checking, so the test pins the lookup's contract.
			getBySlug.mockResolvedValue(null);
			expect(await statusOf(() => requireGroupRole({ slug: 'deleted' }, 'member'))).toBe(404);
		});
	});

	/**
	 * Regression guard for JAVASCRIPT-SVELTEKIT-2T.
	 *
	 * That crash came from `params.slug` being absent on a raced navigation and
	 * `undefined` reaching D1, which answers `D1_TYPE_ERROR: Type 'undefined' not
	 * supported` — a 500 for what is really a 4xx. An explicit ref removes the
	 * cause, but a caller can still hand over a blank one, so the guard still has
	 * to answer it before any query is built.
	 */
	describe('with a blank ref', () => {
		beforeEach(() => {
			// What D1 actually does with an undefined bound parameter, rather than
			// the benign `null` the happy-path mock returns. Without this a missing
			// check reads as a tidy 404 and the test proves nothing.
			const rejectNonString = async (v: unknown) => {
				if (typeof v !== 'string') {
					throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
				}
				return null;
			};
			getBySlug.mockImplementation(rejectNonString);
			getByIdActive.mockImplementation(rejectNonString);
		});

		it.each([
			['empty slug', { slug: '' }],
			['whitespace slug', { slug: '   ' }],
			['undefined slug', { slug: undefined as unknown as string }],
			['empty id', { id: '' }],
			['undefined id', { id: undefined as unknown as string }]
		])('400s on an %s without reaching the database', async (_name, ref) => {
			expect(await statusOf(() => requireGroupRole(ref, 'member'))).toBe(400);
			expect(getBySlug).not.toHaveBeenCalled();
			expect(getByIdActive).not.toHaveBeenCalled();
			expect(getUserRole).not.toHaveBeenCalled();
		});
	});

	describe('the role floor', () => {
		beforeEach(() => getBySlug.mockResolvedValue(GROUP));

		it.each([
			['owner', 'owner', true],
			['owner', 'admin', true],
			['owner', 'member', true],
			['admin', 'owner', false],
			['admin', 'admin', true],
			['admin', 'member', true],
			['member', 'owner', false],
			['member', 'admin', false],
			['member', 'member', true]
		] as const)('a %s against a %s floor: %s', async (held, floor, allowed) => {
			getUserRole.mockResolvedValue(held);
			if (allowed) {
				await expect(requireGroupRole({ slug: 'our-band' }, floor)).resolves.toMatchObject({
					role: held
				});
			} else {
				expect(await statusOf(() => requireGroupRole({ slug: 'our-band' }, floor))).toBe(403);
			}
		});

		it('403s a non-member', async () => {
			getUserRole.mockResolvedValue(null);
			expect(await statusOf(() => requireGroupRole({ slug: 'our-band' }, 'member'))).toBe(403);
		});
	});

	describe('allowStaff', () => {
		beforeEach(() => {
			getBySlug.mockResolvedValue(GROUP);
			getUserRole.mockResolvedValue(null);
		});

		it('403s staff when it is not passed', async () => {
			isElevated.mockResolvedValue(true);
			expect(await statusOf(() => requireGroupRole({ slug: 'our-band' }, 'member'))).toBe(403);
			expect(isElevated).not.toHaveBeenCalled();
		});

		it("admits a staff non-member as role 'staff'", async () => {
			isElevated.mockResolvedValue(true);
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true })
			).resolves.toMatchObject({ role: 'staff' });
			expect(isElevated).toHaveBeenCalledWith('user-1');
		});

		/**
		 * One predicate for "elevated enough to read a group surface".
		 *
		 * A `volunteer_coordinator` holds a position but no `admin`/`staff` role
		 * row. `requireStaff()` and `getBandLayout` both admit them, so a guard
		 * asking `hasAnyRole(['admin','staff'])` here handed them a panel on which
		 * every card 403'd.
		 */
		it('admits a narrow position-holder who has no admin or staff role row', async () => {
			isElevated.mockResolvedValue(true);
			hasAnyRole.mockResolvedValue(false);
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true })
			).resolves.toMatchObject({ role: 'staff' });
			expect(hasAnyRole).not.toHaveBeenCalled();
		});

		/**
		 * Passing `allowStaff` IS the decision that staff may do this thing, so it
		 * bypasses the floor rather than being ranked against it — otherwise the
		 * option would mean different things at different floors.
		 */
		it('bypasses the floor rather than ranking against it', async () => {
			isElevated.mockResolvedValue(true);
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'owner', { allowStaff: true })
			).resolves.toMatchObject({ role: 'staff' });
		});

		it('403s a non-staff non-member even when it is passed', async () => {
			isElevated.mockResolvedValue(false);
			expect(
				await statusOf(() => requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true }))
			).toBe(403);
		});

		/** A member's own role wins; staff status is never consulted for them. */
		it('does not consult staff status for an actual member', async () => {
			getUserRole.mockResolvedValue('member');
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true })
			).resolves.toMatchObject({ role: 'member' });
			expect(isElevated).not.toHaveBeenCalled();
		});
	});
});

/**
 * The kind gates. `requireGroupRole` is deliberately kind-agnostic — a roster
 * is a roster — but the surfaces are not interchangeable: the band editor
 * writes `directoryVisibility`, which for a program is staff's to set, and the
 * program editor omits the listing fields a band needs.
 */
describe('requireBandRole', () => {
	beforeEach(() => getUserRole.mockResolvedValue('admin'));

	it('admits an admin of a band', async () => {
		getBySlug.mockResolvedValue(GROUP);
		await expect(requireBandRole({ slug: 'our-band' }, 'admin')).resolves.toMatchObject({
			role: 'admin'
		});
	});

	it.each([['club'], ['committee']])('404s a %s even for its own admin', async (kind) => {
		getBySlug.mockResolvedValue({ ...CLUB, kind });
		expect(await statusOf(() => requireBandRole({ slug: CLUB.slug }, 'admin'))).toBe(404);
	});

	it('still 403s a non-member of a band', async () => {
		getBySlug.mockResolvedValue(GROUP);
		getUserRole.mockResolvedValue(null);
		expect(await statusOf(() => requireBandRole({ slug: 'our-band' }, 'admin'))).toBe(403);
	});
});

describe('requireProgramRole', () => {
	beforeEach(() => getUserRole.mockResolvedValue('admin'));

	it.each([['club'], ['committee']])('admits an admin of a %s', async (kind) => {
		getBySlug.mockResolvedValue({ ...CLUB, kind });
		await expect(requireProgramRole({ slug: CLUB.slug }, 'admin')).resolves.toMatchObject({
			role: 'admin'
		});
	});

	it('404s a band', async () => {
		getBySlug.mockResolvedValue(GROUP);
		expect(await statusOf(() => requireProgramRole({ slug: 'our-band' }, 'admin'))).toBe(404);
	});
});

describe('requireCommitteeReviewer', () => {
	const COMMITTEE = {
		id: 'group-3',
		slug: 'booking-committee',
		name: 'Booking Committee',
		kind: 'committee'
	};

	const call = () => requireCommitteeReviewer({ slug: 'booking-committee' });
	const statusOf = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
			return 200;
		} catch (err) {
			return (err as { status?: number }).status;
		}
	};

	beforeEach(() => getBySlug.mockResolvedValue(COMMITTEE));

	it('admits the chair, who holds an admin seat', async () => {
		getUserRole.mockResolvedValue('admin');
		await expect(call()).resolves.toMatchObject({ role: 'admin' });
		// The seat is enough on its own; nothing asked for a capability.
		expect(can).not.toHaveBeenCalled();
	});

	it('admits the owner, who outranks admin', async () => {
		getUserRole.mockResolvedValue('owner');
		await expect(call()).resolves.toMatchObject({ role: 'owner' });
	});

	it('refuses a plain member of the committee', async () => {
		getUserRole.mockResolvedValue('member');
		expect(await statusOf(call)).toBe(403);
	});

	/** The whole point: a headless committee has no chair, so this is the only door. */
	it('admits a capability holder with no seat at all', async () => {
		can.mockResolvedValue(true);
		await expect(call()).resolves.toMatchObject({ role: 'staff' });
		expect(can).toHaveBeenCalledWith('committee.reviewApplications');
	});

	it('refuses somebody with neither', async () => {
		expect(await statusOf(call)).toBe(403);
	});

	/**
	 * 404 rather than 403, and checked before the role: a band and a club take
	 * no applications, so naming one is a wrong address. It also stops the
	 * capability reaching sideways into a club a coordinator has no business in.
	 */
	it('404s a club, even for a capability holder', async () => {
		getBySlug.mockResolvedValue(CLUB);
		can.mockResolvedValue(true);
		expect(await statusOf(() => requireCommitteeReviewer({ slug: 'real-book-club' }))).toBe(404);
	});

	it('404s a band', async () => {
		getBySlug.mockResolvedValue(GROUP);
		can.mockResolvedValue(true);
		expect(await statusOf(() => requireCommitteeReviewer({ slug: 'our-band' }))).toBe(404);
	});
});

describe('requireCommitteeMember', () => {
	const COMMITTEE = { id: 'group-3', slug: 'production', name: 'Production', kind: 'committee' };
	const call = (groupId: string | null = 'group-3') =>
		requireCommitteeMember(groupId, 'project.manage');

	beforeEach(() => getByIdActive.mockResolvedValue(COMMITTEE));

	it('admits a plain member of the committee that owns the row', async () => {
		getUserRole.mockResolvedValue('member');
		await expect(call()).resolves.toMatchObject({ role: 'member', group: COMMITTEE });
		expect(getByIdActive).toHaveBeenCalledWith('group-3');
		expect(can).not.toHaveBeenCalled();
	});

	it('refuses a member of some other committee', async () => {
		expect(await statusOf(() => call())).toBe(403);
	});

	it('admits the cover capability, so staff can always act', async () => {
		can.mockResolvedValue(true);
		await expect(call()).resolves.toMatchObject({ role: 'staff' });
		expect(can).toHaveBeenCalledWith('project.manage');
	});

	/** A club's roster owns nothing a committee does, so membership must not reach sideways. */
	it('does not let a club or band roster stand in for a committee', async () => {
		getByIdActive.mockResolvedValue(CLUB);
		getUserRole.mockResolvedValue('owner');
		expect(await statusOf(() => call('group-2'))).toBe(403);
	});

	it('leaves an unowned row to the cover capability alone', async () => {
		expect(await statusOf(() => call(null))).toBe(403);
		expect(getByIdActive).not.toHaveBeenCalled();
		can.mockResolvedValue(true);
		await expect(call(null)).resolves.toMatchObject({ role: 'staff', group: null });
	});

	it('treats a deleted committee as unowned', async () => {
		getByIdActive.mockResolvedValue(null);
		getUserRole.mockResolvedValue('member');
		expect(await statusOf(() => call())).toBe(403);
	});
});

describe('requireCommitteeCapability (#1578)', () => {
	const DEVELOPMENT = {
		id: COMMITTEE_IDS.development,
		slug: 'development-committee',
		name: 'Development Committee',
		kind: 'committee'
	};

	beforeEach(() => getByIdActive.mockResolvedValue(DEVELOPMENT));

	for (const cap of ['sponsor.read', 'sponsor.manage', 'grant.read', 'grant.manage'] as const) {
		it(`admits a Development committee member to ${cap}`, async () => {
			getUserRole.mockResolvedValue('member');
			await expect(requireCommitteeCapability(cap)).resolves.toMatchObject({ role: 'member' });
			expect(getByIdActive).toHaveBeenCalledWith(COMMITTEE_IDS.development);
		});

		it(`refuses ${cap} to someone on no committee and holding no position`, async () => {
			expect(await statusOf(() => requireCommitteeCapability(cap))).toBe(403);
		});
	}

	it('admits staff through the capability itself', async () => {
		can.mockResolvedValue(true);
		await expect(requireCommitteeCapability('grant.manage')).resolves.toMatchObject({
			role: 'staff'
		});
		expect(can).toHaveBeenCalledWith('grant.manage');
	});

	it('lets the treasurer read without letting them manage', async () => {
		can.mockImplementation(async (...a: unknown[]) => a[0] === 'sponsor.read');
		await expect(requireCommitteeCapability('sponsor.read')).resolves.toMatchObject({
			role: 'staff'
		});
		expect(await statusOf(() => requireCommitteeCapability('sponsor.manage'))).toBe(403);
	});

	it('gives a Development committee seat nothing outside its grant', async () => {
		getUserRole.mockResolvedValue('owner');
		expect(await statusOf(() => requireCommitteeCapability('project.manage'))).toBe(403);
		expect(getByIdActive).not.toHaveBeenCalled();
	});
});

describe('committeeCapabilitiesFor (#1578)', () => {
	beforeEach(() =>
		getByIdActive.mockResolvedValue({ id: COMMITTEE_IDS.development, kind: 'committee' })
	);

	it("lists a Development committee member's grant", async () => {
		getUserRole.mockResolvedValue('member');
		expect(await committeeCapabilitiesFor('user-1')).toEqual(
			expect.arrayContaining(['sponsor.read', 'sponsor.manage', 'grant.read', 'grant.manage'])
		);
	});

	it('lists nothing for someone on no committee', async () => {
		expect(await committeeCapabilitiesFor('user-1')).toEqual([]);
	});
});

describe('listCommitteeHolders (#1578)', () => {
	it('returns the active roster of the committee that grants the capability', async () => {
		getByIdActive.mockResolvedValue({ id: COMMITTEE_IDS.development, kind: 'committee' });
		listActiveMembers.mockResolvedValue([{ id: 'u1', name: 'Ada', email: 'ada@x' }]);
		expect(await listCommitteeHolders('grant.manage')).toEqual([
			{ id: 'u1', name: 'Ada', email: 'ada@x' }
		]);
		expect(listActiveMembers).toHaveBeenCalledWith(COMMITTEE_IDS.development);
	});

	it('returns nobody for a capability no committee grants', async () => {
		expect(await listCommitteeHolders('project.manage')).toEqual([]);
		expect(listActiveMembers).not.toHaveBeenCalled();
	});

	it('returns nobody when the committee row is gone', async () => {
		expect(await listCommitteeHolders('sponsor.manage')).toEqual([]);
		expect(listActiveMembers).not.toHaveBeenCalled();
	});
});

describe('renewals are a committee seat too (#1602)', () => {
	beforeEach(() =>
		getByIdActive.mockResolvedValue({ id: COMMITTEE_IDS.development, kind: 'committee' })
	);

	for (const cap of ['renewal.read', 'renewal.manage'] as const) {
		it(`admits a seated member to ${cap}`, async () => {
			getUserRole.mockResolvedValue('member');
			await expect(requireCommitteeCapability(cap)).resolves.toMatchObject({ role: 'member' });
		});

		it(`refuses ${cap} to someone with neither a seat nor a position`, async () => {
			expect(await statusOf(() => requireCommitteeCapability(cap))).toBe(403);
		});

		it(`admits staff to ${cap}`, async () => {
			can.mockResolvedValue(true);
			await expect(requireCommitteeCapability(cap)).resolves.toMatchObject({ role: 'staff' });
		});
	}

	it('lists the seat among its capabilities', async () => {
		getUserRole.mockResolvedValue('member');
		expect(await committeeCapabilitiesFor('user-1')).toEqual(
			expect.arrayContaining(['renewal.read', 'renewal.manage'])
		);
	});
});

describe('listCapabilityHolders', () => {
	it('unions position holders with the seat, once each', async () => {
		getByIdActive.mockResolvedValue({ id: COMMITTEE_IDS.development, kind: 'committee' });
		listUsersWithCapability.mockResolvedValue([
			{ id: 'u1', name: 'Ada', email: 'ada@x' },
			{ id: 'u2', name: 'Bo', email: 'bo@x' }
		]);
		listActiveMembers.mockResolvedValue([
			{ id: 'u2', name: 'Bo', email: 'bo@x' },
			{ id: 'u3', name: 'Cy', email: 'cy@x' }
		]);
		const ids = (await listCapabilityHolders('renewal.manage')).map((u) => u.id);
		expect(ids).toEqual(['u1', 'u2', 'u3']);
	});
});
