import { and, eq, or, sql } from 'drizzle-orm';
import { reservation } from '$lib/server/db/schema/reservation';
import { eventListing } from '$lib/server/db/schema/event';
import { group } from '$lib/server/db/schema/group';
import { production } from '$lib/server/db/schema/production';

/**
 * `bookerId` points at a band only when `bookerType` says so, so the type check
 * belongs in the join — without it a band whose id happened to match a user's
 * would attach to the wrong row.
 */
export function bandBookerJoin() {
	return and(eq(reservation.bookerType, 'group'), eq(group.id, reservation.bookerId));
}

/**
 * The listing a hold is for: through its production, or the listing itself
 * when it has none (#2004). At most one branch matches a row. Functions, not
 * constants: built at import, they break sibling specs whose partial
 * `drizzle-orm` mock lacks `or`.
 */
export function eventBookerJoin() {
	return or(
		and(
			eq(reservation.bookerType, 'production'),
			sql`${eventListing.projectId} = (select ${production.projectId} from ${production} where ${production.id} = ${reservation.bookerId})`
		),
		and(eq(reservation.bookerType, 'event_listing'), eq(eventListing.id, reservation.bookerId))
	);
}

/**
 * Who a listing's room hold is booked to: its production, else the group
 * running it, else the listing itself. Holding the room never opens a
 * production — a listing with neither is still allowed the room (#2004).
 */
export function listingHoldBooker(listing: {
	id: string;
	productionId: string | null;
	groupId: string | null;
}): { bookerType: 'production' | 'group' | 'event_listing'; bookerId: string } {
	if (listing.productionId) return { bookerType: 'production', bookerId: listing.productionId };
	if (listing.groupId) return { bookerType: 'group', bookerId: listing.groupId };
	return { bookerType: 'event_listing', bookerId: listing.id };
}
