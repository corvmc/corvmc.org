import { z } from 'zod';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX, groupKinds } from '$lib/config';
import { mapDomainError } from '$lib/server/errors';
import { error, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, desc, gt, ne } from 'drizzle-orm';
import { requireCapability, requireUser } from '$lib/server/authorization';
import { listAll, listForUser, partitionByStatus } from '$lib/server/band/band-service';
import {
	memberRefColumns,
	reservationRefColumns,
	toBandRef,
	toMemberRef,
	toReservationRef
} from '$lib/server/entity/refs';
import {
	getByIdWithDetails,
	getMembers,
	update,
	updateMember,
	updateOwnMembership,
	create,
	acceptInvitation,
	declineInvitation,
	invite,
	removeMember as removeMemberService,
	revokeInvitation as revokeInvitationService,
	transferOwnership as transferOwnershipService,
	leaveBand as leaveBandService,
	searchMembers as searchMembersService,
	deleteBand as deleteBandService,
	deactivate,
	reactivate,
	setTier,
	BandMemberExistsError
} from '$lib/server/band/band-service';
import { bandTiers } from '$lib/server/db/schema/band-site';
import {
	createInvite as createEmailInviteService,
	listForGroup as listEmailInvitesForGroup,
	revoke as revokeEmailInviteService
} from '$lib/server/group/group-invite-service';
import { requireGroupRole } from '$lib/server/group/group-context';

// ===========================================================================
// Queries — Staff (list)
// ===========================================================================

const staffBandsFilters = z.object({
	search: z.string().optional(),
	status: z.enum(['active', 'deactivated']).optional(),
	tier: z.enum(bandTiers).optional(),
	page: z.number().optional()
});

export const getStaffBands = query(staffBandsFilters, async (filters) => {
	await requireCapability('band.read');
	return listAll(
		{
			search: filters.search || undefined,
			status: filters.status || undefined,
			tier: filters.tier || undefined
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

// ===========================================================================
// Queries — Staff (detail)
// ===========================================================================

export const getStaffBand = query(z.string(), async (id) => {
	await requireCapability('band.read');
	const band = await getByIdWithDetails(id);
	if (!band) error(404, 'Band not found');
	return band;
});

export const getStaffBandMembers = query(z.string(), async (bandId) => {
	await requireCapability('band.read');
	return getMembers(bandId);
});

export const getBandReservations = query(z.string(), async (bandId) => {
	await requireCapability('band.read');
	return db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			notes: reservation.notes,
			createdByUserId: reservation.createdByUserId,
			bookedByName: user.name
		})
		.from(reservation)
		.leftJoin(user, eq(user.id, reservation.createdByUserId))
		.where(and(eq(reservation.bookerType, 'group'), eq(reservation.bookerId, bandId)))
		.orderBy(desc(reservation.startsAt))
		.limit(10);
});

export const getStaffEmailInvites = query(z.string(), async (bandId) => {
	await requireCapability('band.read');
	return listEmailInvitesForGroup(bandId);
});

// ===========================================================================
// Queries — Band-context
// ===========================================================================

const bandIdField = z.string().min(1);

/**
 * The band-context exports below name their band by **id**, not slug.
 *
 * Either is a valid `GroupRef`, and the id is the right one here: three of
 * these queries already took a `bandId` and cross-checked it against the band
 * the old guard resolved from `params.slug` — two sources of truth for one
 * value, and the cross-check was the seam between them. Handing the id
 * straight to the guard deletes the seam rather than translating it.
 */
export const searchBandUsers = query(
	z.object({ bandId: z.string().min(1), q: z.string() }),
	async ({ bandId, q }) => {
		const { group: band } = await requireGroupRole({ id: bandId }, 'admin');
		if (q.length < 2) return [];
		return searchMembersService(q, band.id);
	}
);

/**
 * The outstanding `group_invite` rows — invitations sent to an email address
 * rather than to an account. The other kind of pending invitation is a
 * `group_member` row and comes back with the roster.
 */
export const getBandEmailInvites = query(z.string(), async (bandId) => {
	const { group: band } = await requireGroupRole({ id: bandId }, 'admin');
	return listEmailInvitesForGroup(band.id);
});

// ===========================================================================
// Queries — Band-context (member-facing)
// ===========================================================================

export const getBandUpcoming = query(z.string(), async (bandId) => {
	// `allowStaff`, like every band-panel read below it. `getBandLayout` admits a
	// staff non-member and reports `userRole: 'staff'`, but the member-only guard
	// these carried 403'd them — so staff rendered the panel frame and every card
	// inside it failed. See groups-spec.md § The guard.
	const { group: band } = await requireGroupRole({ id: bandId }, 'member', { allowStaff: true });
	const now = new Date();
	const rows = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			notes: reservation.notes,
			ref: reservationRefColumns(),
			bookedBy: memberRefColumns()
		})
		.from(reservation)
		.leftJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(reservation.bookerType, 'group'),
				eq(reservation.bookerId, bandId),
				gt(reservation.startsAt, now),
				ne(reservation.status, 'cancelled')
			)
		)
		.orderBy(reservation.startsAt)
		.limit(10);

	return rows.map((r) => ({
		...r,
		ref: toReservationRef(r.ref, band),
		bookedBy: toMemberRef(r.bookedBy)
	}));
});

export const getBandMembersList = query(z.string(), async (bandId) => {
	await requireGroupRole({ id: bandId }, 'member', { allowStaff: true });
	// `getMembers` already returns a presentation ref per row, alias included.
	const members = partitionByStatus(await getMembers(bandId));
	return {
		active: members.active,
		pending: members.pending,
		// Applications, which only a `by_application` group can have. Returned
		// rather than dropped: `getMembers` is the whole roster, so filtering to
		// two buckets is what would have rendered applicants mixed into the member
		// list — or, here, nowhere at all.
		requested: members.requested
	};
});

/**
 * The band members page's one load-bearing query.
 *
 * `getBandEmailInvites` is admin-guarded and 403s a plain member into the error boundary, so
 * the page gated it on the viewer's role and held the two queries in flight together — a
 * permission decision made client-side, and the fan-out that past kit 2.64 stops the page
 * rendering at all. Both now resolve here, where the role is already known.
 */
export const getBandMembersPage = query(z.string(), async (bandId) => {
	// The page's own `isStaffOnly` branch — "You're viewing this band as staff.
	// Roster changes go through staff tools." — could never render, because the
	// member-only guard 403'd staff before the page did. `role` comes back as
	// `'staff'` now, so `canManage` is false and that branch is reachable.
	const { role } = await requireGroupRole({ id: bandId }, 'member', { allowStaff: true });
	const canManage = role === 'owner' || role === 'admin';

	const [members, emailInvites] = await Promise.all([
		getBandMembersList(bandId),
		canManage ? getBandEmailInvites(bandId) : []
	]);

	return { members, emailInvites, canManage };
});

export const getMemberBands = query(async () => {
	const currentUser = requireUser();
	// Bands only. Clubs and committees live at `/member/groups`, which answers a
	// different question and has its own index.
	const bands = await listForUser(currentUser.id, ['band']);

	const serialize = (b: (typeof bands)[number]) => ({
		id: b.id,
		name: b.name,
		slug: b.slug,
		avatarKey: b.avatarKey,
		role: b.role,
		status: b.status,
		memberCount: b.memberCount
	});

	// Partitioned rather than filtered twice: a hand-written pair of buckets is
	// where a third status goes missing without anything failing.
	const byStatus = partitionByStatus(bands);
	return {
		pending: byStatus.pending.map(serialize),
		active: byStatus.active.map(serialize),
		// Always empty for a band, which is `invite_only` by construction — but it
		// is the shape the data can take, and leaving it out is how the club
		// mount of this list would lose its applicants.
		requested: byStatus.requested.map(serialize)
	};
});

// ===========================================================================
// Forms — Staff
// ===========================================================================

export const updateStaffBand = form(
	z.object({
		name: z.string().trim().min(1).max(SHORT_TEXT_MAX),
		bio: z.string().trim().max(LONG_TEXT_MAX)
	}),
	async (data) => {
		await requireCapability('band.manage');
		const { params } = getRequestEvent();
		const id = params.id!;
		await update(id, { name: data.name, bio: data.bio || undefined });
		void getStaffBandPage(id).refresh();
		return { success: true };
	}
);

export const updateMemberRole = form(
	z.object({
		memberId: z.string().min(1),
		role: z.enum(['admin', 'member']),
		position: z.string().optional()
	}),
	async (data) => {
		await requireCapability('band.manageMembers');
		await updateMember(data.memberId, {
			role: data.role,
			position: data.position ?? undefined
		});
		const { params } = getRequestEvent();
		void getStaffBandPage(params.id!).refresh();
		return { success: true };
	}
);

// ===========================================================================
// Forms — Staff (from API routes)
// ===========================================================================

export const createBandApi = form(
	z.object({
		name: z.string().min(1),
		bio: z.string().optional(),
		ownerId: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manage');
		const band = await create(data.ownerId, { name: data.name, bio: data.bio });
		return { success: true, bandId: band.id };
	}
);

export const deactivateBand = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manage');
		await deactivate(data.id);
		return { success: true };
	}
);

export const reactivateBand = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manage');
		await reactivate(data.id);
		return { success: true };
	}
);

/** Staff comp/revoke of premium. Stripe-backed bands are refused by the service. */
export const setBandTier = form(
	z.object({
		id: z.string().min(1),
		tier: z.enum(bandTiers)
	}),
	async (data) => {
		await requireCapability('band.setTier');
		try {
			await setTier(data.id, data.tier);
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffBandPage(data.id).refresh();
		return { success: true };
	}
);

export const addBandMember = form(
	z.object({
		bandId: z.string().min(1),
		userId: z.string().min(1),
		role: z.enum(['admin', 'member']),
		position: z.string().optional()
	}),
	async (data) => {
		const staff = await requireCapability('band.manageMembers');
		await invite(data.bandId, data.userId, data.role, data.position ?? null, staff.id);
		return { success: true };
	}
);

export const removeBandMember = form(
	z.object({
		memberId: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manageMembers');
		await removeMemberService(data.memberId);
		return { success: true };
	}
);

export const revokeBandInvite = form(
	z.object({
		memberId: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manageMembers');
		await revokeInvitationService(data.memberId);
		return { success: true };
	}
);

export const transferOwnership = form(
	z.object({
		bandId: z.string().min(1),
		newOwnerId: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manageMembers');
		const band = await getByIdWithDetails(data.bandId);
		if (!band) throw error(404, 'Band not found');
		// An ownerless band is legal, and transferring INTO an empty seat is the
		// normal way staff fix one — so the actor is the outgoing owner when there
		// is one, and the incoming owner when there is not. The service demotes by
		// this id, which matches nothing in the empty case, which is correct.
		await transferOwnershipService(data.bandId, data.newOwnerId, band.ownerId ?? data.newOwnerId);
		return { success: true };
	}
);

export const inviteByEmailApi = form(
	z.object({
		bandId: z.string().min(1),
		email: z.string().email(),
		role: z.enum(['admin', 'member']),
		position: z.string().optional()
	}),
	async (data, issue) => {
		const staff = await requireCapability('band.manageMembers');
		try {
			const result = await createEmailInviteService(
				data.email,
				data.bandId,
				data.role,
				data.position ?? null,
				staff.id
			);
			return { success: true, ...result };
		} catch (err) {
			if (err instanceof BandMemberExistsError) invalid(issue.email(err.message));
			throw err;
		}
	}
);

export const revokeStaffEmailInvite = form(
	z.object({
		inviteId: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('band.manageMembers');
		await revokeEmailInviteService(data.inviteId);
		return { success: true };
	}
);

// ===========================================================================
// Forms — Member (no slug context)
// ===========================================================================

export const createBand = form(
	z.object({
		name: z.string().min(1, 'Act name is required').max(255),
		bio: z.string().max(LONG_TEXT_MAX).optional().default('')
	}),
	async (data) => {
		const currentUser = requireUser();
		const band = await create(currentUser.id, {
			name: data.name,
			bio: data.bio || undefined
		});
		return { success: true, slug: band.slug };
	}
);

// `bandId`, not a group_member row id: the invite list only ever knows the band.
// Both outcomes are returned in-band rather than thrown — a stale or
// already-taken invite is an ordinary user state, and a thrown error would
// reach Sentry as a 500 while showing the member only a generic toast.
export const acceptInvite = form(
	z.object({
		bandId: z.string().min(1)
	}),
	async (data) => {
		const currentUser = requireUser();
		const result = await acceptInvitation(data.bandId, currentUser.id);

		if (result.status === 'not_found') {
			return { success: false as const, reason: 'not_found' as const };
		}
		return { success: true as const };
	}
);

export const declineInvite = form(
	z.object({
		bandId: z.string().min(1)
	}),
	async (data) => {
		const currentUser = requireUser();
		const declined = await declineInvitation(data.bandId, currentUser.id);

		return declined
			? { success: true as const }
			: { success: false as const, reason: 'not_found' as const };
	}
);

// ===========================================================================
// Forms — Band-context (requires band membership)
// ===========================================================================

export const updateBand = form(
	z.object({
		bandId: bandIdField,
		name: z.string().min(1, 'Name is required').max(200),
		bio: z.string().max(LONG_TEXT_MAX).optional().default('')
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		await update(band.id, {
			name: data.name,
			bio: data.bio
		});
		// No slug in the result: renaming does not move the band's address.
		return { success: true };
	}
);

// Was `form('unchecked')` — a form with no fields at all, back when the guard
// read the band out of the request context. The ref is a field now, so there is
// something to validate and the schema comes back.
export const deleteBand = form(z.object({ bandId: bandIdField }), async (data) => {
	const { group: band } = await requireGroupRole({ id: data.bandId }, 'owner');
	await deleteBandService(band.id);
	return { success: true };
});

export const inviteMember = form(
	z.object({
		bandId: bandIdField,
		userId: z.string().min(1, 'User is required'),
		role: z.enum(['admin', 'member']),
		position: z.string().max(100).optional().default('')
	}),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		const member = await invite(band.id, data.userId, data.role, data.position || null, user.id);
		return { success: true, memberId: member.id };
	}
);

export const removeMember = form(
	z.object({
		bandId: bandIdField,
		memberId: z.string().min(1)
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			await removeMemberService(data.memberId, band.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

export const revokeInvitation = form(
	z.object({
		bandId: bandIdField,
		memberId: z.string().min(1)
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			await revokeInvitationService(data.memberId, band.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

/**
 * An admin editing somebody else's row: their role in the band, and the band's
 * word for what they do.
 *
 * Deliberately no `alias`. A stage name is self-identification — an admin can
 * say you play bass, but cannot rename you. That path is
 * `updateMyBandMembership` below, and it is scoped to the caller's own row.
 */
export const updateMemberRemote = form(
	z.object({
		bandId: bandIdField,
		memberId: z.string().min(1),
		role: z.enum(['admin', 'member']).optional(),
		position: z.string().max(100).optional()
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		await updateMember(
			data.memberId,
			{
				role: data.role,
				position: data.position !== undefined ? data.position || null : undefined
			},
			band.id
		);
		return { success: true };
	}
);

/**
 * A member editing their own membership: their stage name and what they play.
 *
 * `position` has been settable only at invite time since bands shipped, and
 * `alias` is new — so this is the only way either can be changed by the person
 * they describe.
 *
 * There is no `memberId` in the schema on purpose. The row comes from the
 * guard's `(band.id, user.id)`, which is unique; keying a mutation on a
 * caller-supplied id when the guard already knows the row is how one member
 * ends up editing another.
 */
export const updateMyBandMembership = form(
	z.object({
		bandId: bandIdField,
		alias: z.string().trim().max(100).optional(),
		position: z.string().trim().max(100).optional()
	}),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
		try {
			await updateOwnMembership(band.id, user.id, {
				alias: data.alias !== undefined ? data.alias || null : undefined,
				position: data.position !== undefined ? data.position || null : undefined
			});
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

export const transferOwner = form(
	z.object({
		bandId: bandIdField,
		newOwnerId: z.string().min(1)
	}),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'owner');
		try {
			await transferOwnershipService(band.id, data.newOwnerId, user.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

// Carries the ref and nothing else — see `deleteBand` above.
export const leave = form(z.object({ bandId: bandIdField }), async (data) => {
	// `requireBandBySlug()` + `requireUser()` let a non-member's submission reach
	// the service, which threw a plain Error — a 500 and a generic toast for what
	// is really a 403. The owner case was worse: `OwnerCannotLeaveError` already
	// maps to 422, but nothing routed it through `mapDomainError`.
	const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
	try {
		await leaveBandService(band.id, user.id);
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

export const inviteByEmail = form(
	z.object({
		bandId: bandIdField,
		email: z.string().email('Valid email required'),
		role: z.enum(['admin', 'member']),
		position: z.string().max(100).optional().default('')
	}),
	async (data, issue) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			const result = await createEmailInviteService(
				data.email,
				band.id,
				data.role,
				data.position || null,
				user.id
			);
			return { success: true, ...result };
		} catch (err) {
			// Already a member / already invited is an ordinary state, not a fault.
			// Thrown, it reached Sentry as a 500 and showed the admin only a
			// generic toast (JAVASCRIPT-SVELTEKIT-2D).
			if (err instanceof BandMemberExistsError) invalid(issue.email(err.message));
			throw err;
		}
	}
);

export const revokeEmailInvite = form(
	z.object({
		bandId: bandIdField,
		inviteId: z.string().min(1)
	}),
	async (data) => {
		// Scoped to this band: the service used to take an invite id alone, so a
		// band admin holding another band's invite id could revoke it.
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			await revokeEmailInviteService(data.inviteId, band.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

// ===========================================================================
// Forms — Band avatar
// ===========================================================================

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserBands = query(z.string(), async (userId) => {
	await requireCapability('band.read');
	// Every kind and every status: a staff member looking at one person's record
	// wants the whole picture, including an invitation that was never accepted
	// and any club or committee they sit on.
	const bands = await listForUser(userId, groupKinds);
	return bands.map((b) => ({
		...b,
		// The member count is what qualifies a band in this list, so it takes the
		// ref's subline rather than a column of its own.
		ref: {
			...toBandRef({ ...b, image: b.avatarKey }),
			subtitle: `${b.memberCount} active members`
		}
	}));
});

/**
 * The staff band detail page's one load-bearing query.
 *
 * Every half is keyed by the same band id, and every mutation that refreshed one of them has that
 * id in scope, so this composes with nothing left orphaned.
 */
export const getStaffBandPage = query(z.string(), async (id) => {
	const [band, members, reservations, emailInvites] = await Promise.all([
		getStaffBand(id),
		getStaffBandMembers(id),
		getBandReservations(id),
		getStaffEmailInvites(id)
	]);

	return { band, members, reservations, emailInvites };
});
