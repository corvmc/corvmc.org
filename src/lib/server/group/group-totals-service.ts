import { db } from '$lib/server/db';
import { group, groupMember } from '$lib/server/db/schema/group';
import { and, count, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { openApplicationCount } from '$lib/server/group/application-service';

/** The staff group lists' "Active" status filter. */
export const activeGroup = (): SQL => isNull(group.deletedAt);

/** The "Deactivated" status filter. */
export const deactivatedGroup = (): SQL => isNotNull(group.deletedAt);

export interface ClubTotals {
	/** Active clubs — what the Clubs list shows by default. */
	clubs: number;
	/** Distinct people holding an active seat in an active club. */
	members: number;
	/** Open application choices naming an active club, as each club's own queue counts them. */
	applications: number;
}

/** Org-wide club totals in one statement; deliberately blind to the table's filters. */
export async function getClubTotals(): Promise<ClubTotals> {
	const seat = alias(groupMember, 'club_seat');
	const club = alias(group, 'seat_club');
	const members = db
		.select({ n: sql<number>`count(distinct ${seat.userId})` })
		.from(seat)
		.innerJoin(club, eq(club.id, seat.groupId))
		.where(and(eq(club.kind, 'club'), isNull(club.deletedAt), eq(seat.status, 'active')));

	const [row] = await db
		.select({
			clubs: count(),
			members: sql<number>`(${members})`,
			applications: sql<number>`coalesce(sum(${openApplicationCount(group.id)}), 0)`
		})
		.from(group)
		.where(and(eq(group.kind, 'club'), activeGroup()));
	return {
		clubs: Number(row?.clubs ?? 0),
		members: Number(row?.members ?? 0),
		applications: Number(row?.applications ?? 0)
	};
}
