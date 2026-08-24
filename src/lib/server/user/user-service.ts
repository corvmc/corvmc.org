import { db } from '$lib/server/db';
import { DomainError } from '../domain-error';
import { user, session } from '$lib/server/db/schema/authentication';
import { band } from '$lib/server/db/schema/band';
import { reservation } from '$lib/server/db/schema/reservation';
import { eq, and, ne, gt, isNull, isNotNull, count, desc } from 'drizzle-orm';
import { cancel as cancelReservation } from '$lib/server/reservation/reservation-service';
import { cancel as cancelSubscription } from '$lib/server/finance/subscription-service';
import { isValidPhone, normalizePhone } from '$lib/utils/phone';

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
 * deactivation and user self-delete. Sets deletedAt, purges sessions, cancels
 * the user's future personal reservations, and cancels their Stripe
 * subscription. Reversible via reactivateUser (which does not restore the
 * cancelled reservations or subscription).
 */
export async function deactivateUser(userId: string) {
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

	// Cancel all future personal reservations booked by this user. Scoped to
	// personal bookings (bookerType 'user') — band/event/lesson reservations
	// belong to those entities, not the leaving user.
	const futureReservations = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				eq(reservation.bookerType, 'user'),
				eq(reservation.bookerId, userId),
				gt(reservation.startsAt, new Date()),
				ne(reservation.status, 'cancelled')
			)
		);

	for (const r of futureReservations) {
		await cancelReservation(r.id, userId, 'Account deactivated', { staffOverride: true });
	}

	// Cancel the Stripe subscription if one exists. The subscription may already
	// be gone, so failures here are non-fatal to the deactivation.
	if (row.stripeId) {
		try {
			await cancelSubscription(row.stripeId);
		} catch {
			// Subscription may not exist — that's fine.
		}
	}

	return row;
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

	for (const id of userIds) {
		if (id === opts.skipUserId) {
			skipped.push(id);
			continue;
		}
		try {
			await deactivateUser(id);
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

/** Restore a soft-deleted user. */
export async function reactivateUser(userId: string) {
	const [row] = await db
		.update(user)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(and(eq(user.id, userId), isNotNull(user.deletedAt)))
		.returning();

	if (!row) throw new UserNotFoundError();
	return row;
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
		.select({ id: user.id, deletedAt: user.deletedAt })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!target) throw new UserNotFoundError();
	if (!target.deletedAt) throw new UserNotDeactivatedError();

	const [{ value: ownedBands }] = await db
		.select({ value: count() })
		.from(band)
		.where(eq(band.ownerId, userId));

	if (ownedBands > 0) throw new UserHasOwnedBandsError();

	// event.createdByUserId cascades, so purging would silently take this
	// member's listings off the public calendar with them. The shows still
	// happen after someone leaves the Collective, and other people's plans are
	// attached to them — so a staffer has to deal with the listings on purpose
	// rather than discovering later that the calendar lost a week of gigs.
	const { countPublishedListingsBy } = await import('$lib/server/event/community-event-service');
	if ((await countPublishedListingsBy(userId)) > 0) {
		throw new UserHasPublishedListingsError();
	}

	try {
		await db.delete(user).where(eq(user.id, userId));
	} catch (err) {
		// Foreign-key constraint from another restrict/no-action reference.
		if (err instanceof Error && /FOREIGN KEY|constraint/i.test(err.message)) {
			throw new UserHasLinkedRecordsError();
		}
		throw err;
	}
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
		.orderBy(desc(session.createdAt));
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
		.orderBy(desc(session.createdAt))
		.limit(1);

	return row?.createdAt ?? null;
}
