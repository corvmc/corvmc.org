import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';

export type BookableBand = { slug: string; name: string; hasSustainingMember: boolean };

/**
 * The bands a member may book the room for: every live band where
 * `requireGroupRole(…, 'member')` passes, which is an active roster row.
 * Bands only: a club's or committee's booking is a program hold, which
 * `notAProgramHold` keeps off the member's own list.
 * `hasSustainingMember` unlocks a recurring series, as `bookBandReservation` requires.
 */
export async function listBookableBands(userId: string): Promise<BookableBand[]> {
	const bands = await db
		.select({ id: group.id, slug: group.slug, name: group.name })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(
			and(
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'band'),
				isNull(group.deletedAt)
			)
		)
		.orderBy(group.name);
	if (bands.length === 0) return [];

	const sustaining = await db
		.selectDistinct({ groupId: groupMember.groupId })
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				inArray(
					groupMember.groupId,
					bands.map((b) => b.id)
				),
				eq(groupMember.status, 'active'),
				sql`${user.subscription} is not null`
			)
		);
	const withSustaining = new Set(sustaining.map((s) => s.groupId));

	return bands.map((b) => ({
		slug: b.slug,
		name: b.name,
		hasSustainingMember: withSustaining.has(b.id)
	}));
}
