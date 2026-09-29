import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { eventListing } from '$lib/server/db/schema/event';
import { group, groupMember } from '$lib/server/db/schema/group';
import { production } from '$lib/server/db/schema/production';
import { projectCommittee } from '$lib/server/db/schema/project';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';

/**
 * Tell the Production committee on each of these shows that it was cancelled,
 * and by whom (#1675). Called after the cancel has been written; a failure here
 * is captured rather than thrown, because the show is already cancelled.
 */
export async function announceShowsCancelled(
	productionIds: readonly string[],
	actorUserId: string | null
): Promise<void> {
	if (productionIds.length === 0) return;
	try {
		const [shows, actor] = await Promise.all([
			db
				.select({
					productionId: production.id,
					projectId: production.projectId,
					eventId: eventListing.id,
					eventTitle: eventListing.title,
					startsAt: eventListing.startsAt
				})
				.from(production)
				.innerJoin(eventListing, eq(eventListing.productionId, production.id))
				.where(inArray(production.id, [...productionIds])),
			actorUserId
				? db.select({ name: user.name }).from(user).where(eq(user.id, actorUserId)).limit(1)
				: Promise.resolve([])
		]);

		for (const show of shows) {
			if (!show.projectId) continue;
			const recipients = await productionSeats(show.projectId, actorUserId);
			if (recipients.length === 0) continue;
			await domainEvents.emit('production.cancelled', {
				productionId: show.productionId,
				eventId: show.eventId,
				eventTitle: show.eventTitle,
				startsAt: show.startsAt.toISOString(),
				cancelledByName: actor[0]?.name ?? null,
				recipients
			});
		}
	} catch (err) {
		captureException(err, { event: 'production.cancelled', productionIds });
	}
}

/** Active seats on the live committees taking part as `'production'`, one per person. */
async function productionSeats(projectId: string, actorUserId: string | null) {
	const rows = await db
		.select({
			userId: user.id,
			userName: user.name,
			userEmail: user.email,
			committeeSlug: group.slug
		})
		.from(projectCommittee)
		.innerJoin(group, eq(group.id, projectCommittee.groupId))
		.innerJoin(groupMember, eq(groupMember.groupId, group.id))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				eq(projectCommittee.projectId, projectId),
				eq(projectCommittee.role, 'production'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt),
				eq(groupMember.status, 'active'),
				isNull(user.deletedAt),
				actorUserId ? ne(user.id, actorUserId) : undefined
			)
		)
		.orderBy(asc(user.name), asc(user.id));
	const seen = new Set<string>();
	return rows.filter((r) => !seen.has(r.userId) && seen.add(r.userId));
}
