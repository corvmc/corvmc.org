import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { LIST_LIMIT } from '#lib/config.js';
import {
	FALLBACK_ROTATION_DAYS,
	getActiveFallbackCode,
	getPendingFallbackCode
} from './fallback-code-service';
import { listMemberCodes } from './member-code-service';
import { LOCK_GRACE_MINUTES } from './ultraloc-client';

/**
 * The codes the door holds or is waiting for, for the Building access sidebar.
 * Only a code's last two digits leave the server: the sidebar tells codes apart,
 * it does not hand them out.
 */

export interface ActiveCode {
	id: string;
	/** Who the code is for: the booker, the key holder, or the label on the lock. */
	name: string;
	/** Last two digits, or null when the app never knew the code. */
	tail: string | null;
	/** Confirmed on the lock, rather than queued for it. */
	onLock: boolean;
}

const tailOf = (code: string | null) => (code ? code.slice(-2) : null);

export async function listActiveCodes(now: Date): Promise<{
	reservations: Array<ActiveCode & { startsAt: Date; endsAt: Date }>;
	keyHolders: Array<ActiveCode & { adopted: boolean }>;
	breakGlass: Array<ActiveCode & { rotatesAt: Date | null }>;
}> {
	// A booking's code stays on the lock for the grace period after it ends.
	const graceStart = new Date(now.getTime() - LOCK_GRACE_MINUTES * 60_000);
	const [bookings, members, active, pending] = await Promise.all([
		db
			.select({
				id: reservation.id,
				name: user.name,
				code: reservation.lockCode,
				syncedAt: reservation.lockSyncedAt,
				startsAt: reservation.startsAt,
				endsAt: reservation.endsAt
			})
			.from(reservation)
			.innerJoin(user, eq(reservation.createdByUserId, user.id))
			.where(
				and(
					eq(reservation.status, 'confirmed'),
					isNotNull(reservation.lockCode),
					gt(reservation.endsAt, graceStart)
				)
			)
			.orderBy(asc(reservation.startsAt))
			.limit(LIST_LIMIT),
		listMemberCodes(),
		getActiveFallbackCode(),
		getPendingFallbackCode()
	]);

	const rotation = (syncedAt: Date) =>
		new Date(syncedAt.getTime() + FALLBACK_ROTATION_DAYS * 86_400_000);

	return {
		reservations: bookings.map((b) => ({
			id: b.id,
			name: b.name,
			tail: tailOf(b.code),
			onLock: b.syncedAt != null,
			startsAt: b.startsAt,
			endsAt: b.endsAt
		})),
		keyHolders: members
			.map((c) => ({
				id: c.id,
				name: c.memberName ?? c.label,
				tail: tailOf(c.code),
				onLock: c.syncedAt != null,
				adopted: c.userId == null
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		breakGlass: [
			...(active
				? [
						{
							id: active.id,
							name: active.id,
							tail: tailOf(active.code),
							onLock: true,
							rotatesAt: active.syncedAt ? rotation(active.syncedAt) : null
						}
					]
				: []),
			...(pending
				? [
						{
							id: pending.id,
							name: pending.id,
							tail: tailOf(pending.code),
							onLock: false,
							rotatesAt: null
						}
					]
				: [])
		]
	};
}
