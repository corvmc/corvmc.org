import { eventListing, eventGroup } from '../../src/lib/server/db/schema/event';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { db } from './db';
import { ptDate } from './util';

/**
 * A program's sessions — the thing that distinguishes a club from a band, since
 * a session happens in the room and holds it.
 *
 * Written straight to the tables rather than through `createGroupEvent`, so the
 * reservation and the `event_group` row are restated here. That the reservation
 * is `bookerType: 'event_listing'` is the whole point: the room is held for the session,
 * not booked by the program, and no credit ledger is touched.
 */
export async function seedGroupSessions(groups: any[]) {
	const rows: any[] = [];

	for (const g of groups) {
		// Two behind and two ahead, so the tab has an archive and a calendar.
		for (const offset of [-21, -7, 7, 21]) {
			const startsAt = ptDate(offset, 19);
			const endsAt = ptDate(offset, 21);
			const eventId = crypto.randomUUID();

			// Only the upcoming ones hold the room — a past session's hold is spent,
			// and seeding one would put a stale confirmed booking on the calendar.
			let reservationId: string | null = null;
			if (offset > 0) {
				const [res] = await db
					.insert(reservation)
					.values({
						bookerType: 'event_listing',
						bookerId: eventId,
						createdByUserId: g.ownerId,
						status: 'confirmed',
						startsAt,
						endsAt
					})
					.returning();
				reservationId = res.id;
			}

			const [e] = await db
				.insert(eventListing)
				.values({
					id: eventId,
					title: `${g.name}: ${offset > 0 ? 'next' : 'past'} session`,
					description: `A regular meeting of ${g.name}.`,
					startsAt,
					endsAt,
					status: 'published',
					publishedAt: new Date(startsAt.getTime() - 10 * 86400000),
					groupId: g.id,
					source: 'group',
					reservationId,
					createdByUserId: g.ownerId
				})
				.returning();

			await db.insert(eventGroup).values({ eventId: e.id, groupId: g.id, sortOrder: 0 });
			rows.push(e);
		}
	}

	return rows;
}
