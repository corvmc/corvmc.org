import { and, ne, sql, type SQL } from 'drizzle-orm';
import { reservation } from '$lib/server/db/schema/reservation';

/**
 * Not a program's free hold — the room CMC or a committee took, rather than a
 * booking somebody owns.
 *
 * Four reads meant this and said `ne(bookerType, 'event_listing')`, shorthand
 * that #855 stops being true. Written to hold in both eras.
 */
export function notAProgramHold(): SQL {
	return and(ne(reservation.bookerType, 'event_listing'), notAProgramGroup())!;
}

/**
 * A correlated subquery, not a join: every caller has its own joins already.
 * Identifiers are spelled out rather than interpolated — drizzle qualifies a
 * column only when the outer statement joins, so an interpolated
 * `reservation.bookerId` would bind to the inner table and never be true.
 */
function notAProgramGroup(): SQL {
	return sql`not (
		"reservation"."booker_type" = 'group'
		and exists (
			select 1 from "group"
			 where "group"."id" = "reservation"."booker_id"
			   and "group"."kind" <> 'band'
		)
	)`;
}
