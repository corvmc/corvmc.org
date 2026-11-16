import { db } from '#lib/server/db/index.js';
import { eventAttendance, eventRsvp } from '#lib/server/db/schema/event-rsvp.js';
import { eventGroup } from '#lib/server/db/schema/event.js';
import { groupMember } from '#lib/server/db/schema/group.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { chunk, chunkInsert, D1_MAX_PARAMS } from '#lib/server/utils/chunk.js';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

// Who came to a program session. Callers guard: the remote resolves the
// program lead and re-scopes the event to their group before calling in.

export interface AttendanceRow {
	userId: string;
	name: string;
	rsvped: boolean;
	attended: boolean;
}

/**
 * Everyone a lead can mark for one session: the group's active roster, anyone
 * who RSVPed, and anyone already marked. A walk-in from the roster needs no
 * RSVP, and someone who has since left the roster can still be unmarked.
 */
export async function listSessionAttendance(
	eventId: string,
	groupId: string
): Promise<AttendanceRow[]> {
	const [roster, rsvps, marks] = await Promise.all([
		db
			.select({
				userId: groupMember.userId,
				name: sql<string>`coalesce(${groupMember.alias}, ${user.name})`
			})
			.from(groupMember)
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(and(eq(groupMember.groupId, groupId), eq(groupMember.status, 'active'))),
		db
			.select({ userId: eventRsvp.userId, name: eventRsvp.attendeeName })
			.from(eventRsvp)
			.where(eq(eventRsvp.eventId, eventId)),
		db
			.select({ userId: eventAttendance.userId, name: user.name })
			.from(eventAttendance)
			.innerJoin(user, eq(user.id, eventAttendance.userId))
			.where(eq(eventAttendance.eventId, eventId))
	]);

	const rsvped = new Set(rsvps.map((r) => r.userId));
	const attended = new Set(marks.map((m) => m.userId));
	const people = new Map<string, string>();
	for (const r of marks) people.set(r.userId, r.name);
	for (const r of rsvps) people.set(r.userId, r.name);
	// The roster name wins: it carries the member's alias in this group.
	for (const r of roster) people.set(r.userId, r.name);

	return [...people]
		.map(([userId, name]) => ({
			userId,
			name,
			rsvped: rsvped.has(userId),
			attended: attended.has(userId)
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Replace a session's attendance with `userIds`. Anyone not on the session's
 * roster or RSVP list is dropped rather than written, so a forged id cannot
 * add a stranger to a group's record.
 */
export async function setSessionAttendance(params: {
	eventId: string;
	groupId: string;
	userIds: string[];
	markedByUserId: string;
}): Promise<void> {
	const { eventId, markedByUserId } = params;
	const people = await listSessionAttendance(eventId, params.groupId);
	const wanted = new Set(params.userIds);
	const added = people.filter((p) => !p.attended && wanted.has(p.userId)).map((p) => p.userId);
	const removed = people.filter((p) => p.attended && !wanted.has(p.userId)).map((p) => p.userId);

	// Chunked both ways: a large roster would pass D1's 100-parameter cap.
	const clears = chunk(removed, D1_MAX_PARAMS - 1).map((ids) =>
		db
			.delete(eventAttendance)
			.where(and(eq(eventAttendance.eventId, eventId), inArray(eventAttendance.userId, ids)))
	);
	const inserts = chunkInsert(
		added.map((userId) => ({ eventId, userId, markedByUserId })),
		(rows) =>
			db
				.insert(eventAttendance)
				.values(rows)
				.onConflictDoNothing({ target: [eventAttendance.eventId, eventAttendance.userId] })
	);
	const [first, ...rest] = [...clears, ...inserts];
	if (first) await db.batch([first, ...rest]);
}

/** Sessions each member was marked at, across every session of this group. */
export async function countAttendanceByMember(groupId: string): Promise<Map<string, number>> {
	const rows = await db
		.select({
			userId: eventAttendance.userId,
			count: sql<number>`cast(count(*) as integer)`
		})
		.from(eventAttendance)
		.where(
			inArray(
				eventAttendance.eventId,
				db
					.select({ id: eventGroup.eventId })
					.from(eventGroup)
					.where(eq(eventGroup.groupId, groupId))
			)
		)
		.groupBy(eventAttendance.userId)
		.orderBy(asc(eventAttendance.userId));
	return new Map(rows.map((r) => [r.userId, r.count]));
}
