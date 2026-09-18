import { sql, getTableColumns } from 'drizzle-orm';
import { eventListing } from '$lib/server/db/schema/event';

/**
 * The event's poster key, from its `media_attachment` (#808).
 *
 * Identifiers are spelled out, not interpolated: drizzle qualifies a column
 * only when the outer statement joins, so an interpolated id binds to the
 * *inner* table and reads as an empty slot. It correlates on `event_listing`
 * by name, so an aliased query needs its own selection.
 */
export const eventPosterKeySql = sql<string | null>`(SELECT "media"."key"
	FROM "media_attachment"
	INNER JOIN "media" ON "media"."id" = "media_attachment"."media_id"
	WHERE "media_attachment"."attachable_type" = 'event_listing'
		AND "media_attachment"."attachable_id" = "event_listing"."id"
		AND "media_attachment"."slot" = 'poster'
	ORDER BY "media_attachment"."created_at" DESC
	LIMIT 1)`;

/**
 * Every column of `event_listing`, with `posterKey` resolved from the
 * attachment instead of the column of the same name.
 *
 * Spread into `.select()` wherever a whole listing row is read, so a read
 * cannot pick the mirror up by naming the bare table. `EventRow` keeps its
 * shape, so its consumers need no change at all.
 */
export const eventListingColumns = {
	...getTableColumns(eventListing),
	posterKey: eventPosterKeySql
};
