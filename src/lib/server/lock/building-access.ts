import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { lockFallbackCode, reservation } from '#lib/server/db/schema/reservation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { LIST_LIMIT } from '#lib/config.js';
import { listMemberCodes } from './member-code-service';

/**
 * The codes the door holds or is waiting for, for the Building access view.
 * Only a code's last two digits leave the server: the list tells codes apart,
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
	reservations: Array<ActiveCode & { startsAt: Date; endsAt: Date; ended: boolean }>;
	keyHolders: Array<ActiveCode & { adopted: boolean }>;
}> {
	// A claimed pool code opens the door until the lock confirms its removal (#2120).
	const [claimed, members] = await Promise.all([
		db
			.select({
				id: lockFallbackCode.id,
				name: user.name,
				code: lockFallbackCode.code,
				syncedAt: lockFallbackCode.syncedAt,
				startsAt: reservation.startsAt,
				endsAt: reservation.endsAt
			})
			.from(lockFallbackCode)
			.innerJoin(reservation, eq(lockFallbackCode.claimedByReservationId, reservation.id))
			.innerJoin(user, eq(reservation.createdByUserId, user.id))
			.where(
				and(isNotNull(lockFallbackCode.claimedByReservationId), isNull(lockFallbackCode.removedAt))
			)
			.orderBy(asc(reservation.startsAt))
			.limit(LIST_LIMIT),
		listMemberCodes()
	]);

	return {
		reservations: claimed.map((c) => ({
			id: c.id,
			name: c.name,
			tail: tailOf(c.code),
			onLock: c.syncedAt != null,
			startsAt: c.startsAt,
			endsAt: c.endsAt,
			ended: c.endsAt <= now
		})),
		keyHolders: members
			.map((c) => ({
				id: c.id,
				name: c.memberName ?? c.label,
				tail: tailOf(c.code),
				onLock: c.syncedAt != null,
				adopted: c.userId == null
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}
