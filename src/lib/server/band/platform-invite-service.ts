import { db } from '$lib/server/db';
import { platformInvite } from '$lib/server/db/schema/platform-invite';
import { band, bandMember } from '$lib/server/db/schema/band';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, gt, desc } from 'drizzle-orm';
import { SEARCH_LIMIT } from '$lib/config';
import { BandMemberExistsError, invite } from './band-service';
import { isUniqueConstraintError } from '$lib/server/db/constraint-errors';
import { domainEvents } from '$lib/server/events/event-bus';
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
	bandId: string,
	role: 'admin' | 'member',
	position: string | null,
	invitedById: string
): Promise<{ type: 'platform_invite' | 'existing_user'; id: string }> {
	const normalizedEmail = email.toLowerCase().trim();

	// Check if user already exists
	const [existingUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, normalizedEmail))
		.limit(1);

	if (existingUser) {
		// Distinguish "already in the band" from "already invited" before the
		// insert, so the admin gets a precise message instead of a generic
		// constraint failure (JAVASCRIPT-SVELTEKIT-2D).
		const [membership] = await db
			.select({ status: bandMember.status })
			.from(bandMember)
			.where(and(eq(bandMember.bandId, bandId), eq(bandMember.userId, existingUser.id)))
			.limit(1);

		if (membership) {
			throw new BandMemberExistsError(
				membership.status === 'active'
					? 'That person is already in this band.'
					: 'That person already has a pending invitation to this band.'
			);
		}

		const row = await invite(bandId, existingUser.id, role, position, invitedById);
		return { type: 'existing_user', id: row.id };
	}

	// Check for existing pending invite for same email+band
	const [existing] = await db
		.select({ id: platformInvite.id })
		.from(platformInvite)
		.where(
			and(
				eq(platformInvite.email, normalizedEmail),
				eq(platformInvite.bandId, bandId),
				eq(platformInvite.status, 'pending')
			)
		)
		.limit(1);

	if (existing) {
		// Refresh expiry
		await db
			.update(platformInvite)
			.set({ expiresAt: expiresAt(), role, position })
			.where(eq(platformInvite.id, existing.id));
		return { type: 'platform_invite', id: existing.id };
	}

	// Create new platform invite
	const [row] = await db
		.insert(platformInvite)
		.values({
			email: normalizedEmail,
			bandId,
			role,
			position,
			invitedById,
			status: 'pending',
			expiresAt: expiresAt()
		})
		.returning();

	// Emit event for email notification (fire-and-forget)
	Promise.resolve().then(async () => {
		try {
			const [bandRow] = await db
				.select({ name: band.name })
				.from(band)
				.where(eq(band.id, bandId))
				.limit(1);
			const [inviter] = await db
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, invitedById))
				.limit(1);

			if (bandRow && inviter) {
				await domainEvents.emit('platform_invite.created', {
					email: normalizedEmail,
					token: row.token,
					bandId,
					bandName: bandRow.name,
					role,
					invitedByName: inviter.name
				});
			}
		} catch (err) {
			captureException(err, { event: 'platform_invite.created', bandId });
		}
	});

	return { type: 'platform_invite', id: row.id };
}

export async function resolvePendingInvites(userId: string, email: string): Promise<number> {
	const normalizedEmail = email.toLowerCase().trim();
	const now = new Date();

	const pending = await db
		.select({
			id: platformInvite.id,
			bandId: platformInvite.bandId,
			role: platformInvite.role,
			position: platformInvite.position,
			invitedById: platformInvite.invitedById
		})
		.from(platformInvite)
		.where(
			and(
				eq(platformInvite.email, normalizedEmail),
				eq(platformInvite.status, 'pending'),
				gt(platformInvite.expiresAt, now)
			)
		);

	if (pending.length === 0) return 0;

	let resolved = 0;
	for (const inv of pending) {
		try {
			// Create band member row (auto-accepted)
			await db.insert(bandMember).values({
				bandId: inv.bandId,
				userId,
				role: inv.role,
				position: inv.position,
				status: 'active',
				invitedById: inv.invitedById
			});

			// Mark invite as accepted
			await db
				.update(platformInvite)
				.set({ status: 'accepted', acceptedAt: now })
				.where(eq(platformInvite.id, inv.id));

			resolved++;
		} catch (err: unknown) {
			// Unique constraint = user already in band, just mark accepted
			if (isUniqueConstraintError(err)) {
				await db
					.update(platformInvite)
					.set({ status: 'accepted', acceptedAt: now })
					.where(eq(platformInvite.id, inv.id));
				resolved++;
			} else {
				captureException(err, { event: 'platform_invite.resolve', inviteId: inv.id });
			}
		}
	}

	return resolved;
}

export async function listForBand(bandId: string) {
	return db
		.select({
			id: platformInvite.id,
			email: platformInvite.email,
			role: platformInvite.role,
			position: platformInvite.position,
			status: platformInvite.status,
			expiresAt: platformInvite.expiresAt,
			createdAt: platformInvite.createdAt,
			invitedByName: user.name
		})
		.from(platformInvite)
		.leftJoin(user, eq(user.id, platformInvite.invitedById))
		.where(eq(platformInvite.bandId, bandId))
		.orderBy(desc(platformInvite.createdAt))
		.limit(SEARCH_LIMIT);
}

/** The invite does not exist, or does not belong to the band doing the asking. */
export class PlatformInviteNotFoundError extends DomainError {
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
export class PlatformInviteNotPendingError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('Can only revoke pending invites');
	}
}

/**
 * Revoke a pending email invite.
 *
 * `bandId` scopes the lookup and the write. Without it the invite id alone was
 * the whole authorization: a band admin holding another band's invite id could
 * revoke it, since the caller's `requireBandAdmin()` only proves they run *a*
 * band. Staff pass no `bandId` — they administer every band by definition.
 */
export async function revoke(inviteId: string, bandId?: string): Promise<void> {
	const scope = bandId
		? and(eq(platformInvite.id, inviteId), eq(platformInvite.bandId, bandId))
		: eq(platformInvite.id, inviteId);

	const [row] = await db
		.select({ status: platformInvite.status })
		.from(platformInvite)
		.where(scope)
		.limit(1);

	if (!row) throw new PlatformInviteNotFoundError();
	if (row.status !== 'pending') throw new PlatformInviteNotPendingError();

	await db.update(platformInvite).set({ status: 'revoked' }).where(scope);
}

export async function getByToken(token: string): Promise<{
	bandName: string;
	inviterName: string;
	role: string;
	email: string;
} | null> {
	const now = new Date();

	const [row] = await db
		.select({
			email: platformInvite.email,
			role: platformInvite.role,
			status: platformInvite.status,
			expiresAt: platformInvite.expiresAt,
			bandName: band.name,
			inviterName: user.name
		})
		.from(platformInvite)
		.innerJoin(band, eq(band.id, platformInvite.bandId))
		.leftJoin(user, eq(user.id, platformInvite.invitedById))
		.where(eq(platformInvite.token, token))
		.limit(1);

	if (!row) return null;
	if (row.status !== 'pending') return null;
	if (row.expiresAt <= now) return null;

	return {
		bandName: row.bandName,
		inviterName: row.inviterName ?? 'Someone',
		role: row.role,
		email: row.email
	};
}
