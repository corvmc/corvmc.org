import { describe, it, expect } from 'vitest';
import { QueryBuilder, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { and, eq, gt, inArray, ne, or } from 'drizzle-orm';
import { reservation } from '$lib/server/db/schema/reservation';
import { eventListing } from '$lib/server/db/schema/event';

/**
 * A group's holds include the ones booked through its listings.
 *
 * A group session books the room as `bookerType: 'event_listing'`, so a plain
 * `bookerType = 'group'` filter cannot see it and a club could not find the
 * hold for its own weekly jam. Rendered rather than executed — the point is the
 * predicate's shape, and `SQLiteSyncDialect` shows it without a database.
 */
const dialect = new SQLiteSyncDialect();

// A real builder, not a stub: `inArray` renders a subquery only when handed
// one, and a fake object is silently read as a value instead.
const qb = new QueryBuilder();

/** The predicate under test, as `getBandReservations` composes it. */
function bookedByGroup(groupId: string) {
	return or(
		and(eq(reservation.bookerType, 'group'), eq(reservation.bookerId, groupId)),
		and(
			eq(reservation.bookerType, 'event_listing'),
			inArray(
				reservation.bookerId,
				qb
					.select({ id: eventListing.id })
					.from(eventListing)
					.where(eq(eventListing.groupId, groupId))
			)
		)
	);
}

describe('the predicate a club sees its holds through', () => {
	const sql = () =>
		dialect.sqlToQuery(
			and(
				bookedByGroup('grp-1'),
				gt(reservation.startsAt, new Date(0)),
				ne(reservation.status, 'cancelled')
			)!
		);

	it('matches a hold the group booked directly', () => {
		expect(sql().sql).toContain('"booker_type" = ?');
	});

	it('also matches a hold booked through one of its listings', () => {
		// The bug: without this branch the club's own session is invisible to it.
		expect(sql().sql).toContain('event_listing');
		expect(sql().sql).toMatch(/or /i);
	});

	it('still excludes cancelled and past rows', () => {
		// The new branch is an addition, not a replacement for the other filters.
		expect(sql().sql).toContain('"status" <> ?');
		expect(sql().sql).toContain('"starts_at" > ?');
	});

	it('scopes the listing subquery to the group', () => {
		// Without this it would match every event hold in the building.
		expect(sql().sql).toContain('"group_id" = ?');
	});
});
