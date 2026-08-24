import { z } from 'zod';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import { mapDomainError } from '$lib/server/errors';
import { error, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, desc, gt, ne } from 'drizzle-orm';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { listAll, listForUser } from '$lib/server/band/band-service';
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
	setBandAvatar,
	clearBandAvatar,
	BandMemberExistsError
} from '$lib/server/band/band-service';
import { bandTiers } from '$lib/server/db/schema/group';
import { getBandLayout } from '$lib/remote/layout.remote';
import {
	createInvite as createPlatformInvite,
	listForBand,
	revoke as revokePlatformInviteService
} from '$lib/server/band/platform-invite-service';
import {
	requireBandMember,
	requireBandAdmin,
	requireBandOwner
} from '$lib/server/band/band-context';

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
	await requireStaff();
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
	await requireStaff();
	const band = await getByIdWithDetails(id);
	if (!band) error(404, 'Band not found');
	return band;
});

export const getStaffBandMembers = query(z.string(), async (bandId) => {
	await requireStaff();
	return getMembers(bandId);
});

export const getBandReservations = query(z.string(), async (bandId) => {
	await requireStaff();
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

export const getStaffPlatformInvites = query(z.string(), async (bandId) => {
	await requireStaff();
	return listForBand(bandId);
});

// ===========================================================================
// Queries — Band-context (slug-based)
// ===========================================================================

export const searchBandUsers = query(z.string(), async (q) => {
	const { band } = await requireBandAdmin();
	if (q.length < 2) return [];
	return searchMembersService(q, band.id);
});

export const getBandPlatformInvites = query(z.void(), async () => {
	const { band } = await requireBandAdmin();
	return listForBand(band.id);
});

// ===========================================================================
// Queries — Band-context (member-facing)
// ===========================================================================

export const getBandUpcoming = query(z.string(), async (bandId) => {
	const { band } = await requireBandMember();
	if (band.id !== bandId) error(403, 'Not authorized');
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
	const { band } = await requireBandMember();
	if (band.id !== bandId) error(403, 'Not authorized');
	// `getMembers` already returns a presentation ref per row, alias included.
	const members = await getMembers(bandId);
	return {
		active: members.filter((m) => m.status === 'active'),
		pending: members.filter((m) => m.status === 'pending')
	};
});

export const getMemberBands = query(async () => {
	const currentUser = requireUser();
	const bands = await listForUser(currentUser.id);

	const serialize = (b: (typeof bands)[number]) => ({
		id: b.id,
		name: b.name,
		slug: b.slug,
		avatarKey: b.avatarKey,
		role: b.role,
		status: b.status,
		memberCount: b.memberCount
	});

	return {
		pending: bands.filter((b) => b.status === 'pending').map(serialize),
		active: bands.filter((b) => b.status === 'active').map(serialize)
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
		await requireStaff();
		const { params } = getRequestEvent();
		const id = params.id!;
		await update(id, { name: data.name, bio: data.bio || undefined });
		void getStaffBand(id).refresh();
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
		await requireStaff();
		await updateMember(data.memberId, {
			role: data.role,
			position: data.position ?? undefined
		});
		const { params } = getRequestEvent();
		void getStaffBandMembers(params.id!).refresh();
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
		await requireStaff();
		const band = await create(data.ownerId, { name: data.name, bio: data.bio });
		return { success: true, bandId: band.id };
	}
);

export const deactivateBand = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireStaff();
		await deactivate(data.id);
		return { success: true };
	}
);

export const reactivateBand = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireStaff();
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
		await requireStaff();
		try {
			await setTier(data.id, data.tier);
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffBand(data.id).refresh();
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
		const staff = await requireStaff();
		await invite(data.bandId, data.userId, data.role, data.position ?? null, staff.id);
		return { success: true };
	}
);

export const removeBandMember = form(
	z.object({
		memberId: z.string().min(1)
	}),
	async (data) => {
		await requireStaff();
		await removeMemberService(data.memberId);
		return { success: true };
	}
);

export const revokeBandInvite = form(
	z.object({
		memberId: z.string().min(1)
	}),
	async (data) => {
		await requireStaff();
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
		await requireStaff();
		const band = await getByIdWithDetails(data.bandId);
		if (!band) throw error(404, 'Band not found');
		await transferOwnershipService(data.bandId, data.newOwnerId, band.ownerId);
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
		const staff = await requireStaff();
		try {
			const result = await createPlatformInvite(
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

export const revokePlatformInvite = form(
	z.object({
		inviteId: z.string().min(1)
	}),
	async (data) => {
		await requireStaff();
		await revokePlatformInviteService(data.inviteId);
		return { success: true };
	}
);

// ===========================================================================
// Forms — Member (no slug context)
// ===========================================================================

export const createBand = form(
	z.object({
		name: z.string().min(1, 'Band name is required').max(255),
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

// `bandId`, not a band_member row id: the invite list only ever knows the band.
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
// Forms — Band-context (slug-based, requires band membership)
// ===========================================================================

export const updateBand = form(
	z.object({
		name: z.string().min(1, 'Name is required').max(200),
		bio: z.string().max(LONG_TEXT_MAX).optional().default('')
	}),
	async (data) => {
		const { band } = await requireBandAdmin();
		await update(band.id, {
			name: data.name,
			bio: data.bio
		});
		// No slug in the result: renaming does not move the band's address.
		return { success: true };
	}
);

// A form with no fields of its own. `z.object({})` no longer resolves against
// kit's schema overload, and there is nothing here to validate anyway — the
// guard on the first line of the handler is the whole check.
export const deleteBand = form('unchecked', async () => {
	const { band } = await requireBandOwner();
	await deleteBandService(band.id);
	return { success: true };
});

export const inviteMember = form(
	z.object({
		userId: z.string().min(1, 'User is required'),
		role: z.enum(['admin', 'member']),
		position: z.string().max(100).optional().default('')
	}),
	async (data) => {
		const { user, band } = await requireBandAdmin();
		const member = await invite(band.id, data.userId, data.role, data.position || null, user.id);
		return { success: true, memberId: member.id };
	}
);

export const removeMember = form(
	z.object({
		memberId: z.string().min(1)
	}),
	async (data) => {
		const { band } = await requireBandAdmin();
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
		memberId: z.string().min(1)
	}),
	async (data) => {
		const { band } = await requireBandAdmin();
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
		memberId: z.string().min(1),
		role: z.enum(['admin', 'member']).optional(),
		position: z.string().max(100).optional()
	}),
	async (data) => {
		const { band } = await requireBandAdmin();
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
		alias: z.string().trim().max(100).optional(),
		position: z.string().trim().max(100).optional()
	}),
	async (data) => {
		const { user, band } = await requireBandMember();
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
		newOwnerId: z.string().min(1)
	}),
	async (data) => {
		const { user, band } = await requireBandOwner();
		try {
			await transferOwnershipService(band.id, data.newOwnerId, user.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

// No fields to validate — see `deleteBand` above.
export const leave = form('unchecked', async () => {
	// `requireBandBySlug()` + `requireUser()` let a non-member's submission reach
	// the service, which threw a plain Error — a 500 and a generic toast for what
	// is really a 403. The owner case was worse: `OwnerCannotLeaveError` already
	// maps to 422, but nothing routed it through `mapDomainError`.
	const { user, band } = await requireBandMember();
	try {
		await leaveBandService(band.id, user.id);
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

export const inviteByEmail = form(
	z.object({
		email: z.string().email('Valid email required'),
		role: z.enum(['admin', 'member']),
		position: z.string().max(100).optional().default('')
	}),
	async (data, issue) => {
		const { user, band } = await requireBandAdmin();
		try {
			const result = await createPlatformInvite(
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

export const revokePlatformInviteRemote = form(
	z.object({
		inviteId: z.string().min(1)
	}),
	async (data) => {
		// Scoped to this band: the service used to take an invite id alone, so a
		// band admin holding another band's invite id could revoke it.
		const { band } = await requireBandAdmin();
		try {
			await revokePlatformInviteService(data.inviteId, band.id);
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

// ===========================================================================
// Forms — Band avatar (slug-based)
// ===========================================================================

export const uploadBandAvatar = form(z.object({ file: z.instanceof(File) }), async (data) => {
	const { band } = await requireBandAdmin();
	await setBandAvatar(band.id, await data.file.arrayBuffer(), data.file.type);
	void getBandLayout(band.slug).refresh();
	return { success: true };
});

// No fields to validate — see `deleteBand` above.
export const removeBandAvatar = form('unchecked', async () => {
	const { band } = await requireBandAdmin();
	await clearBandAvatar(band.id);
	void getBandLayout(band.slug).refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserBands = query(z.string(), async (userId) => {
	await requireStaff();
	// listForUser is unfiltered by status, so pending invitations come through
	// too — a staff member needs to see an invite that was never accepted.
	const bands = await listForUser(userId);
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
