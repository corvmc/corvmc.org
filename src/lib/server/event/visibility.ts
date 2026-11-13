import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { groupMember } from '#lib/server/db/schema/group.js';

export { defaultVisibility } from '#lib/server/db/schema/event.js';

/**
 * Who is reading. `null` is the public: a signed-out visitor, a feed, a
 * profile, the poster. `seesAll` is staff who read every listing anyway.
 */
export type ListingViewer = { userId: string; seesAll?: boolean } | null;

/**
 * The one visibility predicate (#2662). Status is the caller's: this answers
 * only whether `viewer` may see the listing at all. `scripts/event-visibility.spec.ts`
 * fails a public read that does not apply it.
 */
export function visibleTo(viewer: ListingViewer = null): SQL {
	if (!viewer) return eq(eventListing.visibility, 'public');
	if (viewer.seesAll) return sql`1 = 1`;
	return or(
		inArray(eventListing.visibility, ['public', 'members']),
		and(
			eq(eventListing.visibility, 'group'),
			inArray(
				eventListing.groupId,
				db
					.select({ id: groupMember.groupId })
					.from(groupMember)
					.where(and(eq(groupMember.userId, viewer.userId), eq(groupMember.status, 'active')))
			)
		)
	)!;
}

/** Whether `viewer` may see this one listing, by the same predicate. */
export async function canSeeListing(eventId: string, viewer: ListingViewer): Promise<boolean> {
	const [row] = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(and(eq(eventListing.id, eventId), visibleTo(viewer)))
		.limit(1);
	return row !== undefined;
}
