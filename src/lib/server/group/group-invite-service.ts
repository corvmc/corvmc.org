import { db } from '$lib/server/db';
import { groupInvite } from '$lib/server/db/schema/group-invite';
import { groupMember, group } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { SEARCH_LIMIT } from '$lib/config';
import { BandMemberExistsError, invite } from '$lib/server/band/band-service';
import { isUniqueConstraintError } from '$lib/server/db/constraint-errors';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { DomainError } from '$lib/server/domain-error';

const INVITE_EXPIRY_DAYS = 7;

function expiresAt(): Date {
	const d = new Date();
	d.setDate(d.getDate() + INVITE_EXPIRY_DAYS);
	return d;
}

export async function createInvite(
	email: string,
	groupId: string,
	role: 'admin' | 'member',
	position: string | null,
	invitedById: string
): Promise<{ type: 'group_invite' | 'existing_user'; id: string }> {
	const normalizedEmail = email.toLowerCase().trim();

	// Check if user already exists
	const [existingUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, normalizedEmail))
		.limit(1);

	if (existingUser) {
		// Distinguish "already on the roster" from "already invited" before the
		// insert, so the admin gets a precise message instead of a generic
		// constraint failure (JAVASCRIPT-SVELTEKIT-2D).
		const [membership] = await db
			.select({ status: groupMember.status })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, existingUser.id)))
			.limit(1);

		if (membership) {
			throw new BandMemberExistsError(
				membership.status === 'active'
					? 'That person is already in this band.'
					: 'That person already has a pending invitation to this band.'
			);
		}

		const row = await invite(groupId, existingUser.id, role, position, invitedById);
		return { type: 'existing_user', id: row.id };
	}

	// One live invitation per address per roster, enforced by the partial unique
	// index rather than by a SELECT before the INSERT — two admins inviting the
	// same person could interleave between the two statements. Re-inviting
	// refreshes the expiry and the role, which is what the admin means by it.
	//
	// It also **re-sends the email**, which the old branch did not: it refreshed
	// the expiry and returned, so an admin re-inviting somebody whose link had
	// lapsed produced no email at all and no way to tell. The token is untouched
	// by the update, so the link that goes out is the one already issued.
	const [row] = await db
		.insert(groupInvite)
		.values({
			email: normalizedEmail,
			groupId,
			role,
			position,
			invitedById,
			status: 'pending',
			expiresAt: expiresAt()
		})
		.onConflictDoUpdate({
			// A literal, not `eq(groupInvite.status, 'pending')`. SQLite matches an
			// upsert to a partial index by comparing this clause against the index's
			// own, and a bound `?` matches nothing — the statement fails at runtime
			// with "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
			// constraint", which no type check sees. Pinned by the spec beside this.
			target: [groupInvite.groupId, groupInvite.email],
			targetWhere: sql`status = 'pending'`,
			set: { expiresAt: expiresAt(), role, position }
		})
		.returning();

	// Emit event for email notification (fire-and-forget)
	Promise.resolve().then(async () => {
		try {
			const [groupRow] = await db
				.select({ name: group.name, kind: group.kind })
				.from(group)
				.where(eq(group.id, groupId))
				.limit(1);
			const [inviter] = await db
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, invitedById))
				.limit(1);

			if (groupRow && inviter) {
				await domainEvents.emit('group_invite.created', {
					email: normalizedEmail,
					token: row.token,
					groupId,
					groupName: groupRow.name,
					groupKind: groupRow.kind,
					role,
					invitedByName: inviter.name
				});
			}
		} catch (err) {
			captureException(err, { event: 'group_invite.created', groupId });
		}
	});

	return { type: 'group_invite', id: row.id };
}

export async function resolvePendingInvites(userId: string, email: string): Promise<number> {
	const normalizedEmail = email.toLowerCase().trim();
	const now = new Date();

	const pending = await db
		.select({
			id: groupInvite.id,
			groupId: groupInvite.groupId,
			role: groupInvite.role,
			position: groupInvite.position,
			invitedById: groupInvite.invitedById
		})
		.from(groupInvite)
		.where(
			and(
				eq(groupInvite.email, normalizedEmail),
				eq(groupInvite.status, 'pending'),
				gt(groupInvite.expiresAt, now)
			)
		);

	if (pending.length === 0) return 0;

	let resolved = 0;
	for (const inv of pending) {
		try {
			// Create the roster row (auto-accepted)
			await db.insert(groupMember).values({
				groupId: inv.groupId,
				userId,
				role: inv.role,
				position: inv.position,
				status: 'active',
				invitedById: inv.invitedById
			});

			// Mark invite as accepted
			await db
				.update(groupInvite)
				.set({ status: 'accepted', acceptedAt: now })
				.where(eq(groupInvite.id, inv.id));

			resolved++;
		} catch (err: unknown) {
			// Unique constraint = already on the roster, just mark accepted
			if (isUniqueConstraintError(err)) {
				await db
					.update(groupInvite)
					.set({ status: 'accepted', acceptedAt: now })
					.where(eq(groupInvite.id, inv.id));
				resolved++;
			} else {
				captureException(err, { event: 'group_invite.resolve', inviteId: inv.id });
			}
		}
	}

	return resolved;
}

export async function listForGroup(groupId: string) {
	return db
		.select({
			id: groupInvite.id,
			email: groupInvite.email,
			role: groupInvite.role,
			position: groupInvite.position,
			status: groupInvite.status,
			expiresAt: groupInvite.expiresAt,
			createdAt: groupInvite.createdAt,
			invitedByName: user.name
		})
		.from(groupInvite)
		.leftJoin(user, eq(user.id, groupInvite.invitedById))
		.where(eq(groupInvite.groupId, groupId))
		.orderBy(desc(groupInvite.createdAt))
		.limit(SEARCH_LIMIT);
}

/** The invite does not exist, or does not belong to the group doing the asking. */
export class GroupInviteNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Invite not found');
	}
}

/**
 * Already accepted, revoked or expired. An ordinary state — usually two admins
 * clicking Revoke on the same row — not a fault, so it must not reach Sentry as
 * a 500.
 */
export class GroupInviteNotPendingError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('Can only revoke pending invites');
	}
}

/**
 * Revoke a pending email invite.
 *
 * `groupId` scopes the lookup and the write. Without it the invite id alone was
 * the whole authorization: a band admin holding another band's invite id could
 * revoke it, since the caller's admin guard only proves they run *a* group.
 * Staff pass no `groupId` — they administer every group by definition.
 */
export async function revoke(inviteId: string, groupId?: string): Promise<void> {
	const scope = groupId
		? and(eq(groupInvite.id, inviteId), eq(groupInvite.groupId, groupId))
		: eq(groupInvite.id, inviteId);

	const [row] = await db
		.select({ status: groupInvite.status })
		.from(groupInvite)
		.where(scope)
		.limit(1);

	if (!row) throw new GroupInviteNotFoundError();
	if (row.status !== 'pending') throw new GroupInviteNotPendingError();

	await db.update(groupInvite).set({ status: 'revoked' }).where(scope);
}

export async function getByToken(token: string): Promise<{
	groupName: string;
	inviterName: string;
	role: string;
	email: string;
} | null> {
	const now = new Date();

	const [row] = await db
		.select({
			email: groupInvite.email,
			role: groupInvite.role,
			status: groupInvite.status,
			expiresAt: groupInvite.expiresAt,
			groupName: group.name,
			inviterName: user.name
		})
		.from(groupInvite)
		.innerJoin(group, eq(group.id, groupInvite.groupId))
		.leftJoin(user, eq(user.id, groupInvite.invitedById))
		.where(eq(groupInvite.token, token))
		.limit(1);

	if (!row) return null;
	if (row.status !== 'pending') return null;
	if (row.expiresAt <= now) return null;

	return {
		groupName: row.groupName,
		inviterName: row.inviterName ?? 'Someone',
		role: row.role,
		email: row.email
	};
}
