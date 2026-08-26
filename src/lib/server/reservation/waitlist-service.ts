import { db, getRowCount } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, lt, gt, isNull, notInArray, asc } from 'drizzle-orm';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { formatDateInTz, formatTimeInTz } from './timezone';
import { env } from '$env/dynamic/private';
import { DEFAULT_TIMEZONE } from '$lib/config';

const TZ = DEFAULT_TIMEZONE;
const WAITLIST_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// promoteNextWaitlisted — find and notify the next waitlisted reservation
// ---------------------------------------------------------------------------

/**
 * When a time slot is freed (reservation cancelled), find the oldest
 * waitlisted reservation overlapping that slot and notify the member.
 * Only promotes one reservation at a time — first-come-first-served.
 */
export async function promoteNextWaitlisted(
	startsAt: Date,
	endsAt: Date
): Promise<{ promoted: boolean; reservationId?: string }> {
	// Find the oldest waitlisted reservation overlapping this slot
	const candidates = await db
		.select({
			id: reservation.id,
			createdByUserId: reservation.createdByUserId,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(reservation)
		.where(
			and(
				eq(reservation.status, 'waitlisted'),
				isNull(reservation.waitlistNotifiedAt),
				lt(reservation.startsAt, endsAt),
				gt(reservation.endsAt, startsAt)
			)
		)
		.orderBy(asc(reservation.createdAt))
		.limit(1);

	if (candidates.length === 0) {
		return { promoted: false };
	}

	const candidate = candidates[0];

	// Re-verify the slot is actually free (another booking may have taken it)
	const conflicts = await db
		.select({ id: reservation.id })
		.from(reservation)
		.where(
			and(
				notInArray(reservation.status, ['cancelled', 'waitlisted']),
				lt(reservation.startsAt, candidate.endsAt),
				gt(reservation.endsAt, candidate.startsAt)
			)
		)
		.limit(1);

	if (conflicts.length > 0) {
		// Slot was claimed by another booking
		return { promoted: false };
	}

	// Notify the member — set the 24h window
	const now = new Date();
	const expiresAt = new Date(now.getTime() + WAITLIST_WINDOW_MS);

	const result = await db
		.update(reservation)
		.set({
			waitlistNotifiedAt: now,
			waitlistExpiresAt: expiresAt,
			updatedAt: now
		})
		.where(
			and(
				eq(reservation.id, candidate.id),
				eq(reservation.status, 'waitlisted'),
				isNull(reservation.waitlistNotifiedAt)
			)
		);

	if (getRowCount(result) === 0) {
		// Concurrent modification — another process handled it
		return { promoted: false };
	}

	// Look up user info for the notification
	const [owner] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, candidate.createdByUserId))
		.limit(1);

	if (owner) {
		const siteUrl = env.PUBLIC_SITE_URL ?? 'https://corvmc.org';
		const confirmUrl = `${siteUrl}/member/reservations?confirm=${candidate.id}`;

		await domainEvents.emit('reservation.waitlist_slot_available', {
			reservationId: candidate.id,
			userId: candidate.createdByUserId,
			userName: owner.name,
			userEmail: owner.email,
			date: formatDateInTz(candidate.startsAt, TZ),
			startTime: formatTimeInTz(candidate.startsAt, TZ),
			endTime: formatTimeInTz(candidate.endsAt, TZ),
			expiresAt: expiresAt.toISOString(),
			confirmUrl
		});
	}

	return { promoted: true, reservationId: candidate.id };
}

// ---------------------------------------------------------------------------
// expireWaitlisted — cancel expired waitlisted reservations and cascade
// ---------------------------------------------------------------------------

/**
 * Find all waitlisted reservations past their 24h confirmation window,
 * cancel them, and cascade promotion to the next in line.
 */
export async function expireWaitlisted(): Promise<{ expired: number; rePromoted: number }> {
	const now = new Date();

	// Find all expired waitlisted reservations
	const expired = await db
		.select({
			id: reservation.id,
			createdByUserId: reservation.createdByUserId,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt
		})
		.from(reservation)
		.where(and(eq(reservation.status, 'waitlisted'), lt(reservation.waitlistExpiresAt, now)));

	let expiredCount = 0;
	let rePromoted = 0;

	for (const row of expired) {
		// Cancel the expired reservation
		const result = await db
			.update(reservation)
			.set({
				status: 'cancelled',
				cancellationReason: 'Waitlist expired',
				waitlistNotifiedAt: null,
				waitlistExpiresAt: null,
				updatedAt: now
			})
			.where(and(eq(reservation.id, row.id), eq(reservation.status, 'waitlisted')));

		if (getRowCount(result) === 0) continue;
		expiredCount++;

		// Notify the member
		const [owner] = await db
			.select({ name: user.name, email: user.email })
			.from(user)
			.where(eq(user.id, row.createdByUserId))
			.limit(1);

		if (owner) {
			await domainEvents.emit('reservation.waitlist_expired', {
				reservationId: row.id,
				userId: row.createdByUserId,
				userName: owner.name,
				userEmail: owner.email,
				date: formatDateInTz(row.startsAt, TZ),
				startTime: formatTimeInTz(row.startsAt, TZ),
				endTime: formatTimeInTz(row.endsAt, TZ)
			});
		}

		// Cascade: promote the next waitlisted reservation for this slot
		const promotion = await promoteNextWaitlisted(row.startsAt, row.endsAt);
		if (promotion.promoted) rePromoted++;
	}

	return { expired: expiredCount, rePromoted };
}
