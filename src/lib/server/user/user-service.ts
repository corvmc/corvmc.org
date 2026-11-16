import { db } from '#lib/server/db/index.js';
import { isForeignKeyConstraintError } from '#lib/server/db/constraint-errors.js';
import { DomainError } from '../domain-error';
import { user, session } from '#lib/server/db/schema/authentication.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';
import { lockMemberCode, reservation } from '#lib/server/db/schema/reservation.js';
import { and, count, desc, eq, gt, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { cancel as cancelReservation } from '#lib/server/reservation/reservation-service.js';
import {
	cancel as cancelSubscription,
	getSubscription,
	pause as pauseSubscription,
	resume as resumeSubscription,
	unpause as unpauseSubscription
} from '#lib/server/finance/subscription-service.js';
import { revokeMemberCode } from '#lib/server/lock/member-code-service.js';
import { captureException } from '#lib/server/sentry.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { sendAccountRestoredEmail, sendAccountSuspendedEmail } from '#lib/server/auth-emails.js';
import { isValidPhone, normalizePhone } from '#lib/utils/phone.js';
import { fileStaffAction } from '#lib/server/flag/flag-service.js';
import {
	recordRemoval,
	liftOpenRemoval,
	getOpenRemoval,
	listLapsedSuspensions
} from '#lib/server/moderation/removal-service.js';
import { blockEmail, unblockForRemoval } from '#lib/server/moderation/blocklist-service.js';
import type { RemovalLedger } from '#lib/server/db/schema/moderation.js';
import type { RemovalLiftReason } from '#lib/config.js';
import { config } from '#lib/server/site-config/site-config-service.js';
import { removalLink } from '#lib/server/moderation/removal-link.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UserNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('User not found');
		this.name = 'UserNotFoundError';
	}
}

export class UserHasOwnedBandsError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('User still owns one or more bands; transfer or remove them before purging');
		this.name = 'UserHasOwnedBandsError';
	}
}

export class UserHasPublishedListingsError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This member has community listings on the public calendar');
		this.name = 'UserHasPublishedListingsError';
	}
}

export class UserNotDeactivatedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('User must be deactivated before it can be purged');
		this.name = 'UserNotDeactivatedError';
	}
}

export class UserBannedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This account is banned; lift the ban to restore it');
		this.name = 'UserBannedError';
	}
}

export class UserSuspendedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This account is suspended; lift the suspension to restore it');
		this.name = 'UserSuspendedError';
	}
}

export class AccountAlreadyClosedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This account is already closed');
		this.name = 'AccountAlreadyClosedError';
	}
}

export class SuspensionTermError extends DomainError {
	readonly httpStatus = 400;

	constructor(maxDays: number) {
		super(`A suspension lasts between 1 and ${maxDays} days`);
		this.name = 'SuspensionTermError';
	}
}

export class CannotBanSelfError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('You cannot remove your own access');
		this.name = 'CannotBanSelfError';
	}
}

export class UserHasLinkedRecordsError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('User has linked records that prevent permanent deletion');
		this.name = 'UserHasLinkedRecordsError';
	}
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Soft-delete a user: the single offboarding entry point used by both staff
 * deactivation and user self-delete. `actor` says which, and is required
 * because the two send different mail: a member who closed their own account
 * needs no email about the bookings that closing it released. Sets deletedAt, purges sessions, revokes
 * standing door codes, cancels the user's future personal reservations, and
 * cancels their Stripe subscription. Reversible via reactivateUser, which
 * resumes the subscription but restores neither the reservations nor the door
 * code — a withdrawn code is re-granted by staff, not silently reinstated.
 */
export async function deactivateUser(
	userId: string,
	opts: {
		actor: 'member' | 'staff';
		batchId?: string;
		/** A suspension's end: only bookings starting before it are cancelled. */
		until?: Date;
		/** A suspension pauses collection; everything else cancels at period end. */
		billing?: 'cancel' | 'pause';
	}
) {
	const [row] = await db
		.update(user)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(user.id, userId), isNull(user.deletedAt)))
		.returning();

	if (!row) throw new UserNotFoundError();

	// Purge the user's existing sessions so a deactivated account can't keep
	// riding a live session. The per-request hook gate is the primary defense;
	// this removes the now-inert rows instead of letting them expire naturally.
	//
	// Neither is immediate any more: with `session.cookieCache` enabled (auth.ts)
	// better-auth serves the session from the signed cookie without reading these
	// rows, so a user already holding one keeps access until it ages out — up to
	// 60s. Acceptable for offboarding; if a hard cut ever matters, disable the
	// cache rather than adding a second gate.
	await db.delete(session).where(eq(session.userId, userId));

	// Revoke standing door codes. Without this a removed member still opens the
	// building: the lock has no idea the account is gone, and nothing ages a
	// member code out.
	//
	// A lock that is unreachable must not block the removal, so a failure is
	// captured and the row is left un-revoked — it keeps showing as live on the
	// staff codes page, which is where a stuck revoke gets noticed.
	const standingCodes = await db
		.select({ id: lockMemberCode.id })
		.from(lockMemberCode)
		.where(and(eq(lockMemberCode.userId, userId), isNull(lockMemberCode.revokedAt)));

	const revokedCodeIds: string[] = [];
	for (const codeRow of standingCodes) {
		try {
			await revokeMemberCode(codeRow.id, 'Account deactivated');
			revokedCodeIds.push(codeRow.id);
		} catch (err) {
			captureException(err);
		}
	}

	// Cancel this user's own future reservations — the personal ones and the
	// teaching ones, which are two booker types and one person.
	//
	// Band and event bookings are deliberately excluded: they belong to those
	// entities rather than to the leaving member, and the band outlives them.
	//
	// Teaching bookings need the second arm because they are matched differently.
	// A personal booking has `bookerId = userId`; a teaching booking's `bookerId`
	// is the *instructor row's* id, so the original condition could never match
	// one and a deactivated instructor's lessons went on holding the room —
	// silently, with the `instructor` row cascading away underneath them.
	const futureReservations = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				or(
					and(eq(reservation.bookerType, 'user'), eq(reservation.bookerId, userId)),
					// Matched on who booked it rather than on `bookerId`, which points
					// into `instructor` here. The invariant that makes this exact:
					// a teaching booking's instructor has `userId === createdByUserId`.
					and(eq(reservation.bookerType, 'instructor'), eq(reservation.createdByUserId, userId))
				),
				gt(reservation.startsAt, new Date()),
				opts.until ? lt(reservation.startsAt, opts.until) : undefined,
				ne(reservation.status, 'cancelled')
			)
		);

	for (const r of futureReservations) {
		await cancelReservation(r.id, userId, 'Account deactivated', {
			staffOverride: true,
			actor: opts.actor,
			// `userId` is the account being closed, not the staffer closing it.
			actorUserId: opts.actor === 'member' ? userId : null
		});
	}

	// Cancel the Stripe subscription if one exists. The subscription may already
	// be gone, so failures here are non-fatal to the deactivation.
	let subscriptionCancelled = false;
	let subscriptionPaused = false;
	if (row.stripeId) {
		try {
			if (opts.billing === 'pause') {
				await pauseSubscription(row.stripeId);
				subscriptionPaused = true;
			} else {
				await cancelSubscription(row.stripeId);
				subscriptionCancelled = true;
			}
		} catch {
			// Subscription may not exist — that's fine.
		}
	}

	await recordAuditEntry({
		action: 'user.deactivated',
		subject: { type: 'user', id: userId, label: row.name },
		details: {
			reservationsCancelled: futureReservations.length,
			subscriptionCancelled,
			bulk: opts.batchId !== undefined,
			...(opts.batchId ? { batchId: opts.batchId } : {})
		}
	});

	const ledger: RemovalLedger = {
		reservationIds: futureReservations.map((r) => r.id),
		doorCodeIds: revokedCodeIds,
		billing: subscriptionPaused ? 'paused' : subscriptionCancelled ? 'cancel_at_period_end' : 'none'
	};
	return { ...row, ledger };
}

/**
 * Deactivate many users in one pass. Iterates `deactivateUser` per id rather
 * than a single bulk UPDATE so each user's future-reservation cancellation
 * (credit refunds / status transitions) runs through the tested single-user
 * path. The acting staff member (`skipUserId`) is never deactivated, and ids
 * that are missing / already deactivated are collected into `skipped` instead
 * of aborting the batch.
 */
export async function deactivateUsers(
	userIds: string[],
	opts: { skipUserId?: string } = {}
): Promise<{ deactivated: string[]; skipped: string[] }> {
	const deactivated: string[] = [];
	const skipped: string[] = [];
	const batchId = crypto.randomUUID();

	for (const id of userIds) {
		if (id === opts.skipUserId) {
			skipped.push(id);
			continue;
		}
		try {
			await deactivateUser(id, { actor: 'staff', batchId });
			deactivated.push(id);
		} catch (err) {
			if (err instanceof UserNotFoundError) {
				skipped.push(id);
				continue;
			}
			throw err;
		}
	}

	return { deactivated, skipped };
}

/**
 * Restore a soft-deleted user.
 *
 * `deactivateUser` cancels the subscription at period end rather than
 * immediately, so inside the period resuming it is one Stripe call. Past it the
 * subscription is gone and needs a fresh checkout, which is a different message
 * to the member — hence `subscription`, which distinguishes the two rather than
 * leaving a lapsed membership to be discovered later.
 */
export async function reactivateUser(userId: string) {
	const open = await getOpenRemoval(userId);
	if (open?.kind === 'suspension') throw new UserSuspendedError();
	const [row] = await db
		.update(user)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(and(eq(user.id, userId), isNotNull(user.deletedAt), isNull(user.bannedAt)))
		.returning();

	if (!row) {
		const [existing] = await db
			.select({ bannedAt: user.bannedAt })
			.from(user)
			.where(eq(user.id, userId));
		if (existing?.bannedAt) throw new UserBannedError();
		throw new UserNotFoundError();
	}

	return finishRestore(row);
}

/** Clears `deletedAt` with no removal checks: for the paths that lift a removal themselves. */
async function restoreAccount(userId: string) {
	const [row] = await db
		.update(user)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(and(eq(user.id, userId), isNotNull(user.deletedAt)))
		.returning();
	if (!row) throw new UserNotFoundError();
	return finishRestore(row);
}

async function finishRestore<T extends { id: string; name: string; stripeId: string | null }>(
	row: T
) {
	let subscription: 'resumed' | 'active' | 'lapsed' | 'none' = 'none';

	if (row.stripeId) {
		try {
			const info = await getSubscription(row.stripeId);
			if (!info) {
				// The period elapsed while the account was closed, so there is nothing
				// left to resume — restarting needs a fresh checkout.
				subscription = 'lapsed';
			} else if (info.cancelAtPeriodEnd) {
				await resumeSubscription(row.stripeId);
				subscription = 'resumed';
			} else {
				subscription = 'active';
			}
		} catch (err) {
			captureException(err);
			subscription = 'lapsed';
		}
	}

	await recordAuditEntry({
		action: 'user.reactivated',
		subject: { type: 'user', id: row.id, label: row.name },
		details: { subscription }
	});

	return { ...row, subscription };
}

/**
 * Ban a member: record who decided and why, then deactivate the account.
 *
 * Enforcement is deactivation's, unchanged — sessions, door codes, future
 * bookings and the subscription all go the same way, and nothing is deleted.
 * What a ban adds is the record, and that `reactivateUser` refuses the account
 * until `unbanUser` lifts it. An account the member already closed is banned
 * without re-running offboarding, so they cannot quietly come back.
 */
export async function banUser(userId: string, opts: { actorId: string; reason: string }) {
	if (userId === opts.actorId) throw new CannotBanSelfError();

	const now = new Date();
	const [row] = await db
		.update(user)
		.set({ bannedAt: now, bannedById: opts.actorId, banReason: opts.reason, updatedAt: now })
		.where(and(eq(user.id, userId), isNull(user.bannedAt)))
		.returning();

	if (!row) throw new UserNotFoundError();

	await recordAuditEntry({
		action: 'user.banned',
		subject: { type: 'user', id: userId, label: row.name },
		details: { reason: opts.reason }
	});

	// Side effects first, the record last: a retry after a failure part-way
	// re-runs only what is idempotent.
	const ledger: RemovalLedger = row.deletedAt
		? { reservationIds: [], doorCodeIds: [], billing: 'none' }
		: (await deactivateUser(userId, { actor: 'staff' })).ledger;

	const { id: flagId } = await fileStaffAction({
		entityType: 'member_profile',
		entityId: userId,
		staffId: opts.actorId,
		reason: opts.reason
	});
	const removal = await recordRemoval({
		userId,
		actorUserId: opts.actorId,
		kind: 'ban',
		reason: opts.reason,
		flagId,
		ledger
	});
	await blockEmail({
		email: row.email,
		source: 'ban',
		addedByUserId: opts.actorId,
		removalId: removal.id
	});

	await sendAccountSuspendedEmail({
		toEmail: row.email,
		name: row.name,
		appealUrl: removalLink(removal.id)
	});

	return row;
}

/**
 * Lift a ban and restore the account. The one way back from a ban, and the
 * entry point a successful appeal would call.
 */
export async function unbanUser(
	userId: string,
	opts: { actorId: string | null; liftReason?: RemovalLiftReason }
) {
	const [row] = await db
		.update(user)
		.set({ bannedAt: null, bannedById: null, banReason: null, updatedAt: new Date() })
		.where(and(eq(user.id, userId), isNotNull(user.bannedAt)))
		.returning();

	if (!row) throw new UserNotFoundError();

	await recordAuditEntry({
		action: 'user.unbanned',
		subject: { type: 'user', id: userId, label: row.name },
		details: {}
	});

	const restored = await restoreAccount(userId);
	const lifted = await liftOpenRemoval(userId, {
		liftedByUserId: opts.actorId,
		liftReason: opts.liftReason ?? 'staff_lifted'
	});
	if (lifted) await unblockForRemoval(lifted.id);
	await sendAccountRestoredEmail({ toEmail: row.email, name: row.name });
	return restored;
}

/**
 * Suspend a member for a term. Enforcement is deactivation's, scoped to the
 * term: bookings starting before it ends are cancelled, billing is paused
 * rather than cancelled, and the address is not blocklisted. The lapse job
 * lifts it when the term ends; staff may lift it sooner.
 */
export async function suspendUser(
	userId: string,
	opts: { actorId: string; reason: string; days: number }
) {
	if (userId === opts.actorId) throw new CannotBanSelfError();
	const maxDays = await config<number>('moderation.suspensionMaxDays');
	if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > maxDays) {
		throw new SuspensionTermError(maxDays);
	}

	const [target] = await db
		.select({ deletedAt: user.deletedAt })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!target) throw new UserNotFoundError();
	if (target.deletedAt) throw new AccountAlreadyClosedError();

	const endsAt = new Date(Date.now() + opts.days * 86_400_000);

	// The conditional update inside deactivateUser refuses a second, concurrent
	// suspension; the removal is stamped after the side effects.
	const row = await deactivateUser(userId, { actor: 'staff', until: endsAt, billing: 'pause' });
	const { id: flagId } = await fileStaffAction({
		entityType: 'member_profile',
		entityId: userId,
		staffId: opts.actorId,
		reason: opts.reason
	});
	const removal = await recordRemoval({
		userId,
		actorUserId: opts.actorId,
		kind: 'suspension',
		reason: opts.reason,
		flagId,
		endsAt,
		ledger: row.ledger
	});
	await recordAuditEntry({
		action: 'user.suspended',
		subject: { type: 'user', id: userId, label: row.name },
		details: { reason: opts.reason, endsAt: endsAt.toISOString() }
	});
	await sendAccountSuspendedEmail({
		toEmail: row.email,
		name: row.name,
		endsAt,
		appealUrl: removalLink(removal.id)
	});
	return { endsAt };
}

/** Send the removal notice again with a fresh appeal link, for a member whose link expired. */
export async function resendRemovalNotice(userId: string) {
	const open = await getOpenRemoval(userId);
	if (!open) throw new UserNotFoundError();
	const [row] = await db
		.select({ email: user.email, name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!row) throw new UserNotFoundError();
	await sendAccountSuspendedEmail({
		toEmail: row.email,
		name: row.name,
		endsAt: open.kind === 'suspension' ? open.endsAt : null,
		appealUrl: removalLink(open.id)
	});
}

/**
 * End a suspension: restore the account, resume paused billing, then stamp
 * the record. `actorId` is null when the term lapsed on its own.
 */
export async function liftSuspension(
	userId: string,
	opts: { actorId: string | null; liftReason: RemovalLiftReason }
) {
	const open = await getOpenRemoval(userId);
	if (open?.kind !== 'suspension') throw new UserNotFoundError();

	const restored = await restoreAccount(userId);
	if (open.ledger?.billing === 'paused' && restored.stripeId) {
		try {
			await unpauseSubscription(restored.stripeId);
		} catch (err) {
			captureException(err);
		}
	}
	await liftOpenRemoval(userId, { liftedByUserId: opts.actorId, liftReason: opts.liftReason });
	await recordAuditEntry({
		action: 'user.suspension_lifted',
		subject: { type: 'user', id: userId, label: restored.name },
		details: { liftReason: opts.liftReason }
	});
	await sendAccountRestoredEmail({ toEmail: restored.email, name: restored.name });
	return restored;
}

/**
 * Lift every suspension whose term has ended. Idempotent: a lifted row is no
 * longer open, so a re-run finds nothing. One failure does not stop the rest.
 */
export async function liftLapsedSuspensions(now = new Date()) {
	const due = await listLapsedSuspensions(now);
	let lifted = 0;
	for (const userId of due) {
		try {
			await liftSuspension(userId, { actorId: null, liftReason: 'term_lapsed' });
			lifted++;
		} catch (err) {
			captureException(err, { event: 'removal.lapse', userId });
		}
	}
	return { due: due.length, lifted };
}

/**
 * Permanently delete a user row. Only permitted once the user is already
 * soft-deleted. Refuses if the user owns any band (band.ownerId is
 * onDelete: 'restrict'). Other dependent rows are handled by their FK
 * onDelete rules; remaining restrict-style FKs surface as
 * UserHasLinkedRecordsError rather than a raw SQL error.
 */
export async function purgeUser(userId: string) {
	const [target] = await db
		.select({ id: user.id, name: user.name, email: user.email, deletedAt: user.deletedAt })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!target) throw new UserNotFoundError();
	if (!target.deletedAt) throw new UserNotDeactivatedError();

	// Ownership is the roster row since phase 3c; `group.ownerId` was a second
	// copy that could drift from it.
	const [{ value: ownedBands }] = await db
		.select({ value: count() })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(
			and(
				eq(groupMember.userId, userId),
				eq(groupMember.role, 'owner'),
				eq(groupMember.status, 'active'),
				isNull(group.deletedAt)
			)
		);

	if (ownedBands > 0) throw new UserHasOwnedBandsError();

	// event.createdByUserId cascades, so purging would silently take this
	// member's listings off the public calendar with them. The shows still
	// happen after someone leaves the Collective, and other people's plans are
	// attached to them — so a staffer has to deal with the listings on purpose
	// rather than discovering later that the calendar lost a week of gigs.
	const { countPublishedListingsBy } = await import('#lib/server/event/community-event-service.js');
	if ((await countPublishedListingsBy(userId)) > 0) {
		throw new UserHasPublishedListingsError();
	}

	try {
		await db.delete(user).where(eq(user.id, userId));
	} catch (err) {
		// Foreign-key constraint from another restrict/no-action reference.
		if (isForeignKeyConstraintError(err)) {
			throw new UserHasLinkedRecordsError();
		}
		throw err;
	}

	await recordAuditEntry({
		action: 'user.purged',
		subject: { type: 'user', id: userId, label: target.name },
		details: { name: target.name, email: target.email }
	});
}

// ---------------------------------------------------------------------------
// Contact phone
// ---------------------------------------------------------------------------

/**
 * A reservation is only reachable if staff can call whoever booked it, so a
 * usable contact number is a precondition for creating one. Saves `submitted`
 * when the member has nothing usable on file.
 *
 * Reads the column rather than `locals.user.phone`: updateProfile writes
 * straight to the table, so the session copy can be stale.
 *
 * Returns false when the booking should be rejected for want of a number.
 */
export async function ensureContactPhone(userId: string, submitted?: string): Promise<boolean> {
	const [row] = await db
		.select({ phone: user.phone })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	// Left exactly as stored — existing rows keep whatever formatting they have.
	if (isValidPhone(row?.phone)) return true;

	const normalized = normalizePhone(submitted);
	if (!normalized) return false;

	await db
		.update(user)
		.set({ phone: normalized, updatedAt: new Date() })
		.where(eq(user.id, userId));

	return true;
}

// ---------------------------------------------------------------------------
// Sessions (read-only)
// ---------------------------------------------------------------------------

export interface ActiveSession {
	id: string;
	createdAt: Date;
	expiresAt: Date;
	ipAddress: string | null;
	userAgent: string | null;
}

/**
 * Unexpired sessions for one account, newest first.
 *
 * Read-only on purpose: revoking a session is a mutation, and the one lever
 * staff have for cutting off access — deactivation — already deletes them all.
 */
export async function listActiveSessions(userId: string): Promise<ActiveSession[]> {
	return db
		.select({
			id: session.id,
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent
		})
		.from(session)
		.where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
		.orderBy(desc(session.createdAt), desc(session.id));
}

/**
 * When this account last signed in, or null if it never has.
 *
 * Approximated by the newest session row, which is the only login trace stored.
 * Sessions are deleted on deactivation and on sign-out, so this reads as null
 * for a deactivated account rather than as its true last login.
 */
export async function getLastLoginAt(userId: string): Promise<Date | null> {
	const [row] = await db
		.select({ createdAt: session.createdAt })
		.from(session)
		.where(eq(session.userId, userId))
		.orderBy(desc(session.createdAt), desc(session.id))
		.limit(1);

	return row?.createdAt ?? null;
}

/**
 * The name and address a notification needs, or null if there is no such user.
 *
 * Deliberately not filtered by role: the caller has already decided this person
 * may receive the thing being sent. `notifyAssignee` used to find its target by
 * scanning the whole staff list, which was both an O(n) walk to fetch one row
 * and a second, invisible authorization rule sitting behind a lookup.
 */
export async function getUserContact(
	userId: string
): Promise<{ id: string; name: string; email: string } | null> {
	const [row] = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	return row ?? null;
}
