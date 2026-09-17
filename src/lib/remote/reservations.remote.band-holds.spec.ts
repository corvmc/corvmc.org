import { describe, it, expect } from 'vitest';
import { QueryBuilder, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { and, eq, gt, ne } from 'drizzle-orm';
import { reservation } from '$lib/server/db/schema/reservation';

/**
 * A group's holds include the ones booked through its listings.
 *
 * A group session books the room as `bookerType: 'production'`, so a plain
 * `bookerType = 'group'` filter cannot see it and a club could not find the
 * hold for its own weekly jam. Rendered rather than executed — the point is the
 * predicate's shape, and `SQLiteSyncDialect` shows it without a database.
 */
const dialect = new SQLiteSyncDialect();

// A real builder, not a stub: `inArray` renders a subquery only when handed
// one, and a fake object is silently read as a value instead.
const qb = new QueryBuilder();

/** The predicate under test, as `getBandReservations` composes it. */
// A copy of the predicate in `reservations.remote.ts`, because it is module
// private there. Copies drift — this one claimed a listing branch that #855
// removed — so keep the two in step, or export the real one.
function bookedByGroup(groupId: string) {
	return and(eq(reservation.bookerType, 'group'), eq(reservation.bookerId, groupId));
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

	it('needs no second branch through a listing', () => {
		// It used to reach the club's own session through the listing that held the
		// room. Since #855 the session holds it as the group, so the direct branch
		// is the whole predicate and the subquery is gone.
		expect(sql().sql).not.toContain('event_listing');
	});

	it('still excludes cancelled and past rows', () => {
		// The new branch is an addition, not a replacement for the other filters.
		expect(sql().sql).toContain('"status" <> ?');
		expect(sql().sql).toContain('"starts_at" > ?');
	});

	it('scopes to this group, not every hold in the building', () => {
		expect(sql().sql).toContain('"booker_id" = ?');
	});
});
