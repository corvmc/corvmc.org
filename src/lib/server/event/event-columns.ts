import { sql, getTableColumns } from 'drizzle-orm';
import { eventListing } from '$lib/server/db/schema/event';

/**
 * The event's poster key, from its `media_attachment` rather than the
 * `event_listing.poster_key` mirror — still written, no longer read, dropped
 * separately (#617). Identifiers are spelled out, not interpolated: drizzle
 * qualifies a column only when the outer statement joins, so an interpolated
 * id would bind to the *inner* table and read as an empty slot, not an error.
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
