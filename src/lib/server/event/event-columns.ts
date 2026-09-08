import { sql, getTableColumns } from 'drizzle-orm';
import { eventListing } from '$lib/server/db/schema/event';

/**
 * The event's poster key, read from its `media_attachment` rather than from
 * `event_listing.poster_key`.
 *
 * The column is still written — every writer mirrors into it — but nothing
 * reads it. That ordering is the point: the attachment becomes the single
 * source of truth first, and the column is dropped separately, once a release
 * has run against reads that no longer depend on it. See issue #617.
 *
 * A correlated subquery rather than a join, because the reads that need it
 * already carry their own joins and grouping. The slot holds at most one row —
 * `replaceSlot` and `attachExisting` both detach before they attach — so the
 * `LIMIT` is a guard, not a choice between candidates.
 *
 * The identifiers are spelled out rather than interpolated from the drizzle
 * table objects, for the reason `audio-service.ts` records: drizzle only
 * qualifies a column reference when the outer statement has a join, so
 * `${eventListing.id}` renders bare in `select().from(eventListing)` and binds
 * to the *inner* table — a correlation that is never true and reads as an empty
 * slot rather than an error. `event-columns.spec.ts` asserts the shape.
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
 * shape either way, which is why the consumers — the remote layer,
 * `calendar-entry`, `refs`, `band-site-content` — need no change at all.
 */
export const eventListingColumns = {
	...getTableColumns(eventListing),
	posterKey: eventPosterKeySql
};
