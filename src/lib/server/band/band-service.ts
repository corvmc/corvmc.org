import { db } from '$lib/server/db';
import { DomainError } from '../domain-error';
import { isUniqueConstraintError } from '$lib/server/db/constraint-errors';
import { group, groupMember, groupSlugHistory, type GroupRole } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { groupEntryInsert } from '$lib/server/directory/entry-service';
import { bandSite } from '$lib/server/db/schema/band-site';
import { bandSiteInsert, getOrCreateBandSiteId } from './band-site-service';
import { reservation } from '$lib/server/db/schema/reservation';
import { eq, and, ne, gt, sql, or, like, inArray, isNull, isNotNull, count } from 'drizzle-orm';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { bandRefColumns, memberRefColumns, toBandRef, toMemberRef } from '$lib/server/entity/refs';
import { generateSlug, ensureUniqueSlug } from '$lib/server/utils/slug';
import { isReservedSlug } from '$lib/reserved-slugs';
import { cancel as cancelReservation } from '$lib/server/reservation/reservation-service';
import { uploadFile } from '$lib/server/storage';
import { detachSlot, replaceSlot } from '$lib/server/media/media-service';
import { mediaKey } from '$lib/server/storage-keys';
import { sanitizeBio } from '$lib/utils/markdown';
import { captureException } from '$lib/server/sentry';
import { domainEvents } from '$lib/server/event-bus/event-bus';

import type { BandTier } from '$lib/server/db/schema/band-site';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBandData {
	name: string;
	bio?: string;
}

export interface UpdateBandData {
	name?: string;
	bio?: string;
}

export interface UpdateMemberData {
	role?: 'admin' | 'member';
	position?: string | null;
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/**
 * Active members of the band in the surrounding query, as a correlated scalar
 * subquery.
 *
 * Three call sites each carried a copy of this written as a SQL string, which
 * `pnpm check` cannot see inside: the table and column names went unverified,
 * so a schema rename would compile cleanly and throw at runtime. Expressed
 * through the query builder they are back under the type checker, and the
 * duplication is gone with them.
 *
 * The subquery's own `FROM group_member` shadows the outer one in `listForUser`,
 * which selects from the same table — correct, because the only correlation
 * wanted here is on `band.id`.
 */
const activeMemberCount = () =>
	db.$count(groupMember, and(eq(groupMember.groupId, group.id), eq(groupMember.status, 'active')));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BandNotFoundError extends Error {
	constructor() {
		super('Band not found');
		this.name = 'BandNotFoundError';
	}
}

export class BandMemberExistsError extends Error {
	constructor(message = 'User is already a member or has a pending invitation') {
		super(message);
		this.name = 'BandMemberExistsError';
	}
}

export class CannotRemoveOwnerError extends Error {
	constructor() {
		super('Cannot remove or demote the band owner');
		this.name = 'CannotRemoveOwnerError';
	}
}

export class OwnerCannotLeaveError extends Error {
	constructor() {
		super('Owner must transfer ownership before leaving');
		this.name = 'OwnerCannotLeaveError';
	}
}

export class BandTierManagedByStripeError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This band has an active Stripe subscription — change the tier in Stripe instead');
		this.name = 'BandTierManagedByStripeError';
	}
}

// ---------------------------------------------------------------------------
// Create / Update / Delete
// ---------------------------------------------------------------------------

export async function create(ownerId: string, data: CreateBandData) {
	const baseSlug = generateSlug(data.name);
	const slug = await ensureUniqueSlug(baseSlug, group, group.slug, undefined, isReservedSlug);

	const bandId = crypto.randomUUID();

	await db.batch([
		// A previous owner may have released this slug. Claiming it retires their
		// redirect, the same rule `changeBandSlug` enforces — a live band.slug
		// always shadows history, so a stale row here could only resurface later.
		db.delete(groupSlugHistory).where(eq(groupSlugHistory.slug, slug)),
		db.insert(group).values({
			id: bandId,
			name: data.name,
			slug,
			bio: data.bio ? sanitizeBio(data.bio) : null,
			ownerId
		}),
		db.insert(groupMember).values({
			groupId: bandId,
			userId: ownerId,
			role: 'owner',
			status: 'active'
		}),
		// The public listing, in the same batch as the band it belongs to. A band
		// with no entry is not in the directory at all — see `directory-service.ts`
		// — so creating them apart would leave a window where a new band is
		// invisible, and a failed second write would make that permanent.
		groupEntryInsert({
			groupId: bandId,
			name: data.name,
			bio: data.bio ? sanitizeBio(data.bio) : null
		}),
		// The site record, in the same batch for the same reason. It carries the
		// band's tier, so a band without one has no tier to read — and it is what
		// `band_page_config` and `band_media` hang off if the band ever goes
		// premium.
		bandSiteInsert(bandId)
	]);

	const [newBand] = await db.select().from(group).where(eq(group.id, bandId));
	// Callers read `.slug` off this; an unchecked destructure turned an empty
	// re-select into "Cannot read properties of undefined" at the call site.
	if (!newBand) throw new BandNotFoundError();
	return newBand;
}

export async function update(bandId: string, data: UpdateBandData) {
	const updates: Record<string, unknown> = { updatedAt: new Date() };

	// The slug is deliberately NOT re-derived here. It is the band's public
	// address — {slug}.corvmc.org, /directory/bands/{slug}, every bookmark — and
	// renaming used to move all of it silently, with no redirect behind it.
	// Owners change the address on purpose via `changeBandSlug`
	// (band-address-service.ts), which records the old one so it keeps working.
	if (data.name !== undefined) {
		updates.name = data.name;
	}

	if (data.bio !== undefined) {
		updates.bio = data.bio ? sanitizeBio(data.bio).slice(0, 2000) || null : null;
	}

	// `name` and `bio` live in two places on purpose: canonical on `group`, and
	// copied onto the listing. The copy is what an unowned external act (phase
	// 10) has instead, and what the directory orders and searches on — so a
	// rename that wrote only one of them would leave the directory showing the
	// old name indefinitely.
	const entryUpdates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) entryUpdates.name = updates.name;
	if (data.bio !== undefined) entryUpdates.bio = updates.bio;

	const [[updated]] = await db.batch([
		db.update(group).set(updates).where(eq(group.id, bandId)).returning(),
		db.update(directoryEntry).set(entryUpdates).where(eq(directoryEntry.groupId, bandId))
	]);

	if (!updated) throw new BandNotFoundError();
	return updated;
}

export async function deleteBand(bandId: string) {
	const [row] = await db.select().from(group).where(eq(group.id, bandId)).limit(1);
	if (!row) throw new BandNotFoundError();

	// Cancel all future band reservations
	const futureReservations = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				eq(reservation.bookerType, 'group'),
				eq(reservation.bookerId, bandId),
				gt(reservation.startsAt, new Date()),
				ne(reservation.status, 'cancelled')
			)
		);

	for (const r of futureReservations) {
		await cancelReservation(r.id, row.ownerId, 'Band deleted', { staffOverride: true });
	}

	// Release the avatar. Not a delete: `media_attachment` has no foreign key to
	// the group by design, so nothing cascades here, and whether the object can
	// be reclaimed is the sweep's question. See docs/specs/shipped/media-spec.md.
	await detachSlot('group', bandId, 'avatar');

	// Delete band (group_member rows cascade)
	await db.delete(group).where(eq(group.id, bandId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getBySlug(slug: string) {
	const [row] = await db
		.select({
			id: group.id,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			ownerId: group.ownerId,
			avatarKey: group.avatarKey,
			// From the site row since phase 3b. LEFT, with `?? 'free'` applied by
			// the caller-facing shape below: a band whose row somehow went missing
			// should read as free rather than disappear from its own panel.
			tier: bandSite.tier,
			customDomain: bandSite.customDomain,
			customDomainStatus: bandSite.customDomainStatus,
			customDomainHostnameId: bandSite.customDomainHostnameId,
			customDomainVerification: bandSite.customDomainVerification,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(and(eq(group.slug, slug), isNull(group.deletedAt)))
		.groupBy(group.id);

	if (!row) return null;
	// A band with no site row has no tier to read. That should be impossible —
	// creation writes one in the same batch — but reading as `free` keeps the
	// band's own panel working rather than typing `tier` as nullable across
	// every caller.
	return { ...row, tier: row.tier ?? ('free' as const) };
}

export async function getById(bandId: string) {
	const [row] = await db.select().from(group).where(eq(group.id, bandId)).limit(1);
	return row ?? null;
}

export async function listForUser(
	userId: string,
	props = {
		id: group.id,
		name: group.name,
		slug: group.slug,
		avatarKey: group.avatarKey,
		role: groupMember.role,
		status: groupMember.status,
		memberCount: activeMemberCount()
	}
) {
	return db
		.select(props)
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(and(eq(groupMember.userId, userId), isNull(group.deletedAt)))
		.orderBy(group.name);
}

export async function getMembers(bandId: string) {
	const rows = await db
		.select({
			id: groupMember.id,
			userId: groupMember.userId,
			role: groupMember.role,
			position: groupMember.position,
			alias: groupMember.alias,
			status: groupMember.status,
			invitedById: groupMember.invitedById,
			createdAt: groupMember.createdAt,
			// Carries name, email, pronouns, image, role and sustaining status —
			// a superset of the flat columns this used to select.
			member: memberRefColumns()
		})
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(eq(groupMember.groupId, bandId))
		.orderBy(
			sql`case ${groupMember.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
			user.name
		);

	return rows.map((row) => ({
		...row,
		member: {
			...toMemberRef(row.member),
			// A stage name is this band's word for who this is, so it takes the
			// title here — the account name stays on the member's own profile.
			...(row.alias ? { title: row.alias } : {}),
			// The position is what qualifies this person *in this band*, so it takes
			// the subline where it exists and the email falls back to the member's own
			// page. Both call sites used to print the email and the position on two
			// separate lines, which is a third line on a two-line row.
			subtitle: row.position ?? row.member.email
		}
	}));
}

export async function searchMembers(query: string, bandId: string) {
	const pattern = `%${query}%`;
	return db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(
			and(
				or(like(user.name, pattern), like(user.email, pattern)),
				isNull(user.deletedAt),
				sql`NOT EXISTS (
					SELECT 1 FROM ${groupMember}
					WHERE ${groupMember.groupId} = ${bandId}
					AND ${groupMember.userId} = ${user.id}
				)`
			)
		)
		.limit(10);
}

/**
 * Band lookup by name, for the lineup editor.
 *
 * Deliberately not the staff `searchBands` in reservations.remote, which is
 * `requireStaff()` and returns owner contact details. This is the band-facing
 * shape: just enough to render a chip and store an id.
 */
export async function searchBandsByName(query: string) {
	return db
		.select({ id: group.id, name: group.name, slug: group.slug, avatarKey: group.avatarKey })
		.from(group)
		.where(and(like(group.name, `%${query}%`), isNull(group.deletedAt)))
		.orderBy(group.name)
		.limit(10);
}

// ---------------------------------------------------------------------------
// Membership management
// ---------------------------------------------------------------------------

export async function invite(
	bandId: string,
	userId: string,
	role: 'admin' | 'member',
	position: string | null,
	invitedById: string
) {
	try {
		const [row] = await db
			.insert(groupMember)
			.values({
				groupId: bandId,
				userId,
				role,
				position,
				status: 'pending',
				invitedById
			})
			.returning();

		// Emit domain event (fire-and-forget)
		Promise.resolve().then(async () => {
			try {
				const [bandRow] = await db
					.select({ name: group.name })
					.from(group)
					.where(eq(group.id, bandId))
					.limit(1);
				const [invitedUser] = await db
					.select({ name: user.name, email: user.email })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1);
				const [inviter] = await db
					.select({ name: user.name })
					.from(user)
					.where(eq(user.id, invitedById))
					.limit(1);

				if (bandRow && invitedUser && inviter) {
					await domainEvents.emit('band.invitation_sent', {
						bandId,
						bandName: bandRow.name,
						invitedUserId: userId,
						invitedUserName: invitedUser.name,
						invitedUserEmail: invitedUser.email,
						invitedByName: inviter.name
					});
				}
			} catch (err) {
				captureException(err, { event: 'band.invitation_sent', bandId });
			}
		});

		return row;
	} catch (err: unknown) {
		// Unique constraint violation = user already in band.
		if (isUniqueConstraintError(err)) {
			throw new BandMemberExistsError();
		}
		throw err;
	}
}

/**
 * Invitations are keyed by `(bandId, userId)` — the pair the unique constraint
 * already enforces — not by `group_member.id`. The UI only ever knows the band
 * (`listForUser` selects `id: band.id`), so keying on the row id meant the
 * predicate matched nothing and every accept threw: JAVASCRIPT-SVELTEKIT-2A.
 *
 * Accepting is idempotent. A member who double-submits, or returns to a stale
 * page and clicks Accept on an invite they already took, is in the state they
 * asked for — that is a success, not an error.
 */
export type AcceptInvitationResult =
	{ status: 'accepted'; bandId: string } | { status: 'already_active' } | { status: 'not_found' };

export async function acceptInvitation(
	bandId: string,
	userId: string
): Promise<AcceptInvitationResult> {
	const [row] = await db
		.update(groupMember)
		.set({ status: 'active' })
		.where(
			and(
				eq(groupMember.groupId, bandId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'pending')
			)
		)
		.returning();

	if (!row) {
		const [existing] = await db
			.select({ status: groupMember.status })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, bandId), eq(groupMember.userId, userId)))
			.limit(1);

		return existing?.status === 'active' ? { status: 'already_active' } : { status: 'not_found' };
	}

	// Emit domain event (fire-and-forget)
	Promise.resolve().then(async () => {
		try {
			const [bandRow] = await db
				.select({ name: group.name })
				.from(group)
				.where(eq(group.id, row.groupId))
				.limit(1);
			const [acceptedUser] = await db
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);

			// Get band admins/owners to notify (single join query)
			const adminUsers = await db
				.select({ id: user.id, name: user.name, email: user.email })
				.from(groupMember)
				.innerJoin(user, eq(user.id, groupMember.userId))
				.where(
					and(
						eq(groupMember.groupId, row.groupId),
						inArray(groupMember.role, ['owner', 'admin']),
						eq(groupMember.status, 'active'),
						ne(groupMember.userId, userId)
					)
				);

			if (bandRow && acceptedUser) {
				await domainEvents.emit('band.invitation_accepted', {
					bandId: row.groupId,
					bandName: bandRow.name,
					acceptedByUserId: userId,
					acceptedByName: acceptedUser.name,
					bandAdmins: adminUsers.map((u) => ({
						userId: u.id,
						userName: u.name,
						userEmail: u.email
					}))
				});
			}
		} catch (err) {
			captureException(err, { event: 'band.invitation_accepted' });
		}
	});

	return { status: 'accepted', bandId: row.groupId };
}

/**
 * Returns whether a pending invitation was actually removed. The previous
 * version discarded the delete result, so the UI toasted "Invitation declined"
 * even when nothing matched and the invite reappeared on the next load.
 */
export async function declineInvitation(bandId: string, userId: string): Promise<boolean> {
	const rows = await db
		.delete(groupMember)
		.where(
			and(
				eq(groupMember.groupId, bandId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'pending')
			)
		)
		.returning({ id: groupMember.id });

	return rows.length > 0;
}

// When `bandId` is provided (band-context callers), the row must belong to
// that band — a band admin's authority stops at their own band, and the
// memberId comes from the client. Staff-context callers omit it.
function memberScope(memberId: string, bandId?: string) {
	return bandId
		? and(eq(groupMember.id, memberId), eq(groupMember.groupId, bandId))
		: eq(groupMember.id, memberId);
}

export async function revokeInvitation(memberId: string, bandId?: string) {
	return db
		.delete(groupMember)
		.where(and(memberScope(memberId, bandId), eq(groupMember.status, 'pending')));
}

export async function removeMember(memberId: string, bandId?: string) {
	const scope = memberScope(memberId, bandId);
	const [row] = await db.select({ role: groupMember.role }).from(groupMember).where(scope).limit(1);

	if (!row) throw new Error('Member not found');
	if (row.role === 'owner') throw new CannotRemoveOwnerError();

	return db.delete(groupMember).where(scope);
}

export async function updateMember(memberId: string, data: UpdateMemberData, bandId?: string) {
	const scope = memberScope(memberId, bandId);
	const [row] = await db.select({ role: groupMember.role }).from(groupMember).where(scope).limit(1);

	if (!row) throw new Error('Member not found');
	if (row.role === 'owner') throw new CannotRemoveOwnerError();

	const updates: Record<string, unknown> = {};
	if (data.role !== undefined) updates.role = data.role;
	if (data.position !== undefined) updates.position = data.position;

	return db.update(groupMember).set(updates).where(scope);
}

export interface UpdateOwnMembershipData {
	alias?: string | null;
	position?: string | null;
}

/**
 * A member editing their own row.
 *
 * Deliberately not `updateMember`: that one refuses any row whose role is
 * 'owner', which is what stops an admin demoting the owner — but it would also
 * lock an owner out of their own stage name. Role is not settable here at all,
 * so that protection has nothing to protect.
 *
 * Scoped by `(bandId, userId)`, which is unique, and to an active membership:
 * a pending invitee has not joined yet and has nothing to name.
 */
export async function updateOwnMembership(
	bandId: string,
	userId: string,
	data: UpdateOwnMembershipData
) {
	const updates: Record<string, unknown> = {};
	if (data.alias !== undefined) updates.alias = data.alias;
	if (data.position !== undefined) updates.position = data.position;
	if (Object.keys(updates).length === 0) return;

	return db
		.update(groupMember)
		.set(updates)
		.where(
			and(
				eq(groupMember.groupId, bandId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active')
			)
		);
}

export async function transferOwnership(bandId: string, newOwnerId: string, actorId: string) {
	const [target] = await db
		.select({ status: groupMember.status })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, bandId), eq(groupMember.userId, newOwnerId)))
		.limit(1);

	if (!target || target.status !== 'active') {
		throw new Error('New owner must be an active band member');
	}

	await db.batch([
		db
			.update(groupMember)
			.set({ role: 'admin' })
			.where(
				and(
					eq(groupMember.groupId, bandId),
					eq(groupMember.userId, actorId),
					eq(groupMember.role, 'owner')
				)
			),
		db
			.update(groupMember)
			.set({ role: 'owner' })
			.where(
				and(
					eq(groupMember.groupId, bandId),
					eq(groupMember.userId, newOwnerId),
					eq(groupMember.status, 'active')
				)
			),
		db.update(group).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(group.id, bandId))
	]);
}

export async function leaveBand(bandId: string, userId: string) {
	const [row] = await db
		.select({ role: groupMember.role })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, bandId), eq(groupMember.userId, userId)))
		.limit(1);

	if (!row) throw new Error('Not a member of this band');
	if (row.role === 'owner') throw new OwnerCannotLeaveError();

	return db
		.delete(groupMember)
		.where(and(eq(groupMember.groupId, bandId), eq(groupMember.userId, userId)));
}

// ---------------------------------------------------------------------------
// Staff queries
// ---------------------------------------------------------------------------

export async function listAll(
	opts?: { search?: string; status?: 'active' | 'deactivated'; tier?: BandTier },
	pagination: PaginationInput = {}
) {
	const conditions = [];

	if (opts?.search) {
		conditions.push(like(group.name, `%${opts.search}%`));
	}
	if (opts?.status === 'active') {
		conditions.push(isNull(group.deletedAt));
	} else if (opts?.status === 'deactivated') {
		conditions.push(isNotNull(group.deletedAt));
	}
	if (opts?.tier) {
		conditions.push(eq(bandSite.tier, opts.tier));
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const dataQ = db
		.select({
			id: group.id,
			name: group.name,
			slug: group.slug,
			ownerId: group.ownerId,
			// Two records per row: the band the row is, and the member who owns it.
			ref: bandRefColumns(),
			owner: memberRefColumns(),
			tier: bandSite.tier,
			memberCount: activeMemberCount(),
			createdAt: group.createdAt,
			deletedAt: group.deletedAt
		})
		.from(group)
		.innerJoin(user, eq(user.id, group.ownerId))
		// LEFT: a band missing its site row must still appear in the staff list.
		// This is the staff view of every band, and it is precisely where a band
		// with something wrong with it needs to be visible rather than hidden.
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(where)
		.orderBy(group.name)
		.$dynamic();

	const countQ = db
		.select({ count: count() })
		.from(group)
		.innerJoin(user, eq(user.id, group.ownerId))
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(where);

	const { rows, pagination: page } = await paginate(dataQ, countQ, pagination);
	return {
		rows: rows.map((r) => ({
			...r,
			tier: r.tier ?? ('free' as const),
			ref: toBandRef(r.ref),
			owner: toMemberRef(r.owner)
		})),
		pagination: page
	};
}

export async function getByIdWithDetails(bandId: string) {
	const [row] = await db
		.select({
			id: group.id,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			ownerId: group.ownerId,
			owner: memberRefColumns(),
			avatarKey: group.avatarKey,
			tier: bandSite.tier,
			subscription: bandSite.subscription,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			deletedAt: group.deletedAt,
			memberCount: activeMemberCount()
		})
		.from(group)
		.innerJoin(user, eq(user.id, group.ownerId))
		// LEFT: this is the staff detail page, and a band with something wrong
		// with it is exactly the one staff need to be able to open.
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(eq(group.id, bandId));

	if (!row) return null;
	return { ...row, tier: row.tier ?? ('free' as const), owner: toMemberRef(row.owner) };
}

export async function deactivate(bandId: string) {
	const now = new Date();
	// Both flags, in one batch. The directory filters on the entry's, so a band
	// deactivated here without it would leave the panel read-only while its
	// listing stayed up.
	const [[row]] = await db.batch([
		db
			.update(group)
			.set({ deletedAt: now, updatedAt: now })
			.where(and(eq(group.id, bandId), isNull(group.deletedAt)))
			.returning(),
		db
			.update(directoryEntry)
			.set({ deletedAt: now, updatedAt: now })
			.where(eq(directoryEntry.groupId, bandId))
	]);

	if (!row) throw new BandNotFoundError();

	// Cancel all future band reservations
	const futureReservations = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				eq(reservation.bookerType, 'group'),
				eq(reservation.bookerId, bandId),
				gt(reservation.startsAt, new Date()),
				ne(reservation.status, 'cancelled')
			)
		);

	for (const r of futureReservations) {
		await cancelReservation(r.id, row.ownerId, 'Band deactivated', { staffOverride: true });
	}

	return row;
}

export async function reactivate(bandId: string) {
	const now = new Date();
	const [[row]] = await db.batch([
		db
			.update(group)
			.set({ deletedAt: null, updatedAt: now })
			.where(and(eq(group.id, bandId), isNotNull(group.deletedAt)))
			.returning(),
		db
			.update(directoryEntry)
			.set({ deletedAt: null, updatedAt: now })
			.where(eq(directoryEntry.groupId, bandId))
	]);

	if (!row) throw new BandNotFoundError();
	return row;
}

/**
 * Staff comp/revoke of the premium tier.
 *
 * A comped band carries `tier: 'premium'` with a null `subscription`, which is
 * exactly what `clearStaleBands` in the Stripe sync skips over (it only clears
 * bands whose subscription JSON is set), so the comp survives the nightly
 * reconciliation. Bands that *do* pay through Stripe are refused here — letting
 * staff flip the column would silently diverge from the live subscription.
 */
export async function setTier(bandId: string, tier: BandTier) {
	// Existence first, so a missing band still raises the domain error that maps
	// to a 404 rather than the raw "no group to create a band site for" that
	// `getOrCreateBandSiteId` would throw.
	if (!(await getById(bandId))) throw new BandNotFoundError();

	// Both the guard and the write read the site row. Reading `group.subscription`
	// here would consult a column nothing writes any more, so a band that DOES pay
	// through Stripe would sail past the guard and have its tier flipped out from
	// under the live subscription — the exact thing this check exists to stop.
	const siteId = await getOrCreateBandSiteId(bandId);
	const [existing] = await db
		.select({ subscription: bandSite.subscription })
		.from(bandSite)
		.where(eq(bandSite.id, siteId))
		.limit(1);
	if (!existing) throw new BandNotFoundError();
	if (existing.subscription) throw new BandTierManagedByStripeError();

	const [row] = await db
		.update(bandSite)
		.set({ tier, updatedAt: new Date() })
		.where(eq(bandSite.id, siteId))
		.returning();

	if (!row) throw new BandNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Role check
// ---------------------------------------------------------------------------

export async function getUserRole(bandId: string, userId: string): Promise<GroupRole | null> {
	const [row] = await db
		.select({ role: groupMember.role, status: groupMember.status })
		.from(groupMember)
		.where(
			and(
				eq(groupMember.groupId, bandId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active')
			)
		)
		.limit(1);

	return (row?.role as GroupRole) ?? null;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/** Upload a band avatar to storage and persist its key. */
export async function setBandAvatar(bandId: string, buffer: ArrayBuffer, contentType: string) {
	const [row] = await db
		.select({ avatarKey: group.avatarKey })
		.from(group)
		.where(eq(group.id, bandId))
		.limit(1);
	if (!row) throw new BandNotFoundError();

	const key = mediaKey('bands/avatars', bandId, contentType);
	await uploadFile(buffer, key, contentType);

	// Records the new object and releases the old one. The previous avatar is
	// detached rather than deleted — see `replaceSlot`.
	await replaceSlot({
		attachableType: 'group',
		attachableId: bandId,
		slot: 'avatar',
		key,
		contentType,
		byteSize: buffer.byteLength
	});

	// `group.avatarKey` stays as the read path: it is selected inline by dozens
	// of existing queries, and one writer keeps it in step with the slot above.
	await db.update(group).set({ avatarKey: key, updatedAt: new Date() }).where(eq(group.id, bandId));
	return key;
}

/** Remove a band's avatar from storage and clear its key. */
export async function clearBandAvatar(bandId: string) {
	const [row] = await db
		.select({ avatarKey: group.avatarKey })
		.from(group)
		.where(eq(group.id, bandId))
		.limit(1);
	if (!row) throw new BandNotFoundError();

	await detachSlot('group', bandId, 'avatar');

	await db
		.update(group)
		.set({ avatarKey: null, updatedAt: new Date() })
		.where(eq(group.id, bandId));
}
