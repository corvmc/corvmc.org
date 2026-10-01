import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getNotificationType, notificationPreference } from '$lib/server/db/schema/notification';

// ---------------------------------------------------------------------------
// Who a notification may be delivered to
// ---------------------------------------------------------------------------
// One check at the dispatch seam rather than one per fan-out. The lists that
// feed `dispatch()` are roster reads, any of which can go stale, and a removal
// is sometimes a moderation action — continuing to write to someone the
// organisation removed is the wrong outcome on its own terms.
// ---------------------------------------------------------------------------

/**
 * Whether this account can still be written to.
 *
 * A missing row counts as undeliverable: a purged user is more gone than a
 * soft-deleted one, not less.
 */
export async function isDeliverable(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ deletedAt: user.deletedAt })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	return Boolean(row) && !row.deletedAt;
}

export interface BatchRecipient {
	userId: string;
	name: string;
	email: string;
	emailEnabled: boolean;
	inAppEnabled: boolean;
}

/** One bound parameter per id, beside the type: well under D1's 100. */
const IN_CHUNK = 90;

/**
 * `isDeliverable` and `getPreference` for many members at once: the live
 * accounts among `userIds`, each with their channels for `type`. A mandatory
 * type, like `getPreference`, ignores stored rows.
 */
export async function listBatchRecipients(
	userIds: string[],
	type: string
): Promise<BatchRecipient[]> {
	const def = getNotificationType(type);
	const defaults = def?.defaults ?? { email: true, inApp: true, sms: false };
	const out: BatchRecipient[] = [];
	for (let i = 0; i < userIds.length; i += IN_CHUNK) {
		const rows = await db
			.select({
				userId: user.id,
				name: user.name,
				email: user.email,
				emailEnabled: notificationPreference.emailEnabled,
				inAppEnabled: notificationPreference.inAppEnabled
			})
			.from(user)
			.leftJoin(
				notificationPreference,
				and(
					eq(notificationPreference.userId, user.id),
					eq(notificationPreference.notificationType, type)
				)
			)
			.where(and(inArray(user.id, userIds.slice(i, i + IN_CHUNK)), isNull(user.deletedAt)));
		for (const r of rows) {
			out.push({
				userId: r.userId,
				name: r.name,
				email: r.email,
				emailEnabled: def?.mandatory ? defaults.email : (r.emailEnabled ?? defaults.email),
				inAppEnabled: def?.mandatory ? defaults.inApp : (r.inAppEnabled ?? defaults.inApp)
			});
		}
	}
	return out;
}
