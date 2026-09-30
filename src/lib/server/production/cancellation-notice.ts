import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { eventListing } from '$lib/server/db/schema/event';
import { production } from '$lib/server/db/schema/production';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import type { OpenOwnedItem } from '$lib/server/volunteer/deliverables-service';

/**
 * A cancelled show calls off its committees' open deliverables and tells every
 * committee that had one (#1709). Dynamic imports, like `resolveWorkOrder`'s,
 * so the production and volunteer domains do not import each other.
 */

/**
 * The open committee items on these productions' shows. Read it **before** the
 * cancel writes: afterwards a production no longer reads as confirmed, nor a
 * listing as published, and finished items would read as open again.
 */
export async function openDeliverablesOnProductions(
	productionIds: readonly string[]
): Promise<OpenOwnedItem[]> {
	if (productionIds.length === 0) return [];
	try {
		const shows = await db
			.select({ id: eventListing.id })
			.from(eventListing)
			.where(inArray(eventListing.productionId, [...productionIds]));
		const { listOpenOwnedOnShows } = await import('$lib/server/volunteer/deliverables-service');
		return await listOpenOwnedOnShows(shows.map((s) => s.id));
	} catch (err) {
		captureException(err, { event: 'production.cancelled.read', productionIds });
		return [];
	}
}

/** The same read for the production a listing announces, if it announces one. */
export async function openDeliverablesOnListing(eventId: string): Promise<OpenOwnedItem[]> {
	try {
		const [row] = await db
			.select({ productionId: eventListing.productionId })
			.from(eventListing)
			.where(eq(eventListing.id, eventId))
			.limit(1);
		return row?.productionId ? await openDeliverablesOnProductions([row.productionId]) : [];
	} catch (err) {
		captureException(err, { event: 'production.cancelled.read', eventId });
		return [];
	}
}

/**
 * Called after the cancel has been written, with what `openDeliverablesOnProductions`
 * read before it. A failure is captured rather than thrown: the show is already
 * cancelled. The canceller is never told, and a committee with nothing open hears
 * nothing.
 */
export async function announceShowsCancelled(
	productionIds: readonly string[],
	actorUserId: string | null,
	openBefore: readonly OpenOwnedItem[]
): Promise<void> {
	if (productionIds.length === 0 || openBefore.length === 0) return;
	try {
		const { cancelDeliverables, committeeSeats } =
			await import('$lib/server/volunteer/deliverables-service');
		const [shows, actor, seats] = await Promise.all([
			db
				.select({
					productionId: production.id,
					eventId: eventListing.id,
					eventTitle: eventListing.title,
					startsAt: eventListing.startsAt
				})
				.from(production)
				.innerJoin(eventListing, eq(eventListing.productionId, production.id))
				.where(inArray(production.id, [...productionIds])),
			actorUserId
				? db.select({ name: user.name }).from(user).where(eq(user.id, actorUserId)).limit(1)
				: Promise.resolve([]),
			committeeSeats([...new Set(openBefore.map((i) => i.groupId))])
		]);
		await cancelDeliverables(
			openBefore.map((i) => i.id),
			actorUserId
		);

		for (const show of shows) {
			const recipients = new Map<string, Recipient>();
			for (const item of openBefore.filter((i) => i.eventId === show.eventId)) {
				for (const seat of seats.get(item.groupId) ?? []) {
					if (seat.userId === actorUserId) continue;
					const r = recipients.get(seat.userId) ?? {
						userId: seat.userId,
						userName: seat.userName,
						userEmail: seat.userEmail,
						committeeSlug: seat.groupSlug,
						items: []
					};
					if (!r.items.includes(item.title)) r.items.push(item.title);
					recipients.set(seat.userId, r);
				}
			}
			if (recipients.size === 0) continue;
			await domainEvents.emit('production.cancelled', {
				productionId: show.productionId,
				eventId: show.eventId,
				eventTitle: show.eventTitle,
				startsAt: show.startsAt.toISOString(),
				cancelledByName: actor[0]?.name ?? null,
				recipients: [...recipients.values()]
			});
		}
	} catch (err) {
		captureException(err, { event: 'production.cancelled', productionIds });
	}
}

interface Recipient {
	userId: string;
	userName: string;
	userEmail: string;
	committeeSlug: string;
	items: string[];
}
