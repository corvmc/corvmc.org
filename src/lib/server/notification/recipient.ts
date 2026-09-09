import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { eq } from 'drizzle-orm';

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
