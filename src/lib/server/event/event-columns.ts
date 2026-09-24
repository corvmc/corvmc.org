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
 * A listing's sale terms from `ticket_sale` (#1203), under the names the
 * listing row has always carried them by. No sale row reads as not on sale,
 * free, with a floor of zero — what the retired columns defaulted to.
 * Identifiers are spelled out, as above.
 */
export const ticketSaleColumns = {
	ticketingEnabled: sql<boolean>`COALESCE((SELECT "ticket_sale"."enabled" FROM "ticket_sale"
	WHERE "ticket_sale"."event_listing_id" = "event_listing"."id"), 0)`.mapWith(Boolean),
	ticketPrice: sql<number | null>`(SELECT "ticket_sale"."price_cents" FROM "ticket_sale"
	WHERE "ticket_sale"."event_listing_id" = "event_listing"."id")`,
	ticketPriceFloorCents: sql<number>`COALESCE((SELECT "ticket_sale"."price_floor_cents" FROM "ticket_sale"
	WHERE "ticket_sale"."event_listing_id" = "event_listing"."id"), 0)`,
	ticketQuantity: sql<number | null>`(SELECT "ticket_sale"."quantity" FROM "ticket_sale"
	WHERE "ticket_sale"."event_listing_id" = "event_listing"."id")`
};

/** A listing's sale terms as its row carries them. */
export interface ListingSaleTerms {
	ticketingEnabled: boolean;
	ticketPrice: number | null;
	ticketPriceFloorCents: number;
	ticketQuantity: number | null;
}

/** What a listing with no `ticket_sale` row reads as. */
export const noSaleTerms: ListingSaleTerms = {
	ticketingEnabled: false,
	ticketPrice: null,
	ticketPriceFloorCents: 0,
	ticketQuantity: null
};

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
	posterKey: eventPosterKeySql,
	...ticketSaleColumns
};

/**
 * Bills short of the act count their production asks for (#859).
 *
 * Correlated subqueries rather than the joined `production` row, because the
 * index's count query is over `event_listing` alone and carries the same
 * predicate. A null target never matches: nobody said, so the bill is not
 * short of anything. Identifiers are spelled out for the reason above.
 */
export const shortOfActsSql = sql`(SELECT "p"."acts_wanted" FROM "production" "p"
	WHERE "p"."id" = "event_listing"."production_id") >
	(SELECT count(*) FROM "event_band" "eb"
	WHERE "eb"."event_id" = "event_listing"."id")`;
