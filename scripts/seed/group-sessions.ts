import {
	eventListing,
	eventGroup,
	programSessionKind,
	defaultVisibility
} from '../../src/lib/server/db/schema/event';
import { claimRoom } from './room';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { eventAttendance } from '../../src/lib/server/db/schema/event-rsvp';
import { groupMember } from '../../src/lib/server/db/schema/group';
import { and, eq } from 'drizzle-orm';
import { batchInsert, db } from './db';
import { ptDate } from './util';

/**
 * A program's sessions — the thing that distinguishes a club from a band, since
 * a session happens in the room and holds it.
 *
 * Written straight to the tables rather than through `createGroupEvent`, so the
 * reservation and the `event_group` row are restated here. That the reservation
 * is `bookerType: 'group'` is the whole point: the room is the programme's, free,
 * not booked by the program, and no credit ledger is touched.
 */
export async function seedGroupSessions(groups: any[]) {
	const rows: any[] = [];
	const marks: (typeof eventAttendance.$inferInsert)[] = [];

	for (const g of groups) {
		const members = await db
			.select({ userId: groupMember.userId })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, g.id), eq(groupMember.status, 'active')))
			.orderBy(groupMember.userId);

		// Two behind and two ahead, so the tab has an archive and a calendar.
		for (const offset of [-21, -7, 7, 21]) {
			const startsAt = ptDate(offset, 19);
			const endsAt = ptDate(offset, 21);
			const eventId = crypto.randomUUID();

			// Only the upcoming ones hold the room — a past session's hold is spent,
			// and seeding one would put a stale confirmed booking on the calendar.
			let reservationId: string | null = null;
			if (offset > 0 && claimRoom(startsAt, endsAt, 'group-session')) {
				const [res] = await db
					.insert(reservation)
					.values({
						bookerType: 'group',
						bookerId: g.id,
						createdByUserId: g.ownerId,
						status: 'confirmed',
						// A programme's room is free, as `insertReservation` writes it.
						cashDueCents: 0,
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
					kind: programSessionKind,
					visibility: defaultVisibility(programSessionKind, g.kind),
					reservationId,
					createdByUserId: g.ownerId
				})
				.returning();

			await db.insert(eventGroup).values({ eventId: e.id, groupId: g.id, sortOrder: 0 });
			rows.push(e);

			// A past session has attendance: most of the roster, a different few
			// missing each time, so the roster's counts differ.
			if (offset < 0) {
				const skip = offset === -21 ? 3 : 2;
				members.forEach((m, i) => {
					if (i % skip !== skip - 1) {
						marks.push({ eventId: e.id, userId: m.userId, markedByUserId: g.ownerId });
					}
				});
			}
		}
	}

	await batchInsert(eventAttendance, marks);
	return rows;
}
