import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';

export interface AttachableListing {
	id: string;
	title: string;
	startsAt: Date;
}

/**
 * The CMC shows on the calendar that "New production" can attach to: not over,
 * not cancelled, and not already announcing a production. `createProduction`
 * re-checks the last of these when it claims the row.
 */
export async function listAttachableListings(now = new Date()): Promise<AttachableListing[]> {
	return db
		.select({ id: eventListing.id, title: eventListing.title, startsAt: eventListing.startsAt })
		.from(eventListing)
		.where(
			and(
				eq(eventListing.source, 'cmc'),
				eq(eventListing.kind, 'show'),
				ne(eventListing.status, 'cancelled'),
				sql`not exists (select 1 from "production" "p"
					where "p"."project_id" = "event_listing"."project_id")`,
				gt(eventListing.endsAt, now)
			)
		)
		.orderBy(asc(eventListing.startsAt))
		.limit(100);
}
