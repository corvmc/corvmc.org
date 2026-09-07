import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireGroupRole } from '$lib/server/group/group-context';
import { DEFAULT_TIMEZONE, LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import { buildTimeRangeInTz } from '$lib/server/reservation/timezone';
import {
	cancelGroupSession as cancelSession,
	createGroupEvent,
	getById as getEventById,
	publish,
	unpublish,
	updateGroupSession as updateSession
} from '$lib/server/event/event-service';

/**
 * A club's or committee's sessions.
 *
 * Reads live on `getMemberGroup`, which returns the sessions with the rest of
 * the page in one round trip — a per-tab query fanned out of a section component
 * is what `custom/no-concurrent-remote-queries` exists to stop. What is here
 * is the write.
 *
 * Flagged on `groupEvents`, separately from `groups`: this is the one path
 * outside the staff panel that can reserve the room, and a program holding time
 * is not a thing to turn on by accident.
 */

export const createGroupSession = form(
	z.object({
		groupId: z.string().min(1),
		title: z.string().min(1, 'Give the session a name').max(SHORT_TEXT_MAX),
		description: z.string().max(LONG_TEXT_MAX).optional(),
		// A date and two times rather than two `datetime-local` values, matching
		// `createBandEventForm`: `datetime-local` submits no timezone, and the app
		// already resolves local wall-clock time through `DEFAULT_TIMEZONE`.
		sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
		startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time'),
		// Required, unlike a band gig's. A session that holds the room needs an end
		// for the reservation to have one.
		endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick an end time'),
		/**
		 * Hold the room. Optional and defaulted false, because kit 2.70 refuses a
		 * required boolean in a `form()` schema — an unchecked checkbox sends
		 * nothing, and here "absent" genuinely does mean "do not reserve".
		 */
		reserveRoom: z.boolean().optional().default(false)
	}),
	async (data, issue) => {
		// Owner or admin, matching the spec's role table: members read the
		// calendar, they do not put things on it.
		const { user, group } = await requireGroupRole({ id: data.groupId }, 'admin');

		// `buildTimeRangeInTz` rolls a past-midnight end onto the next day, which
		// is why the comparison happens after it rather than on the raw strings.
		const { startsAt, endsAt } = buildTimeRangeInTz(
			data.sessionDate,
			data.startTime,
			data.endTime,
			DEFAULT_TIMEZONE
		);
		if (endsAt <= startsAt) {
			invalid(issue.endTime('The session has to end after it starts'));
		}

		try {
			const evt = await createGroupEvent({
				groupId: group.id,
				createdByUserId: user.id,
				title: data.title,
				description: data.description || undefined,
				startsAt,
				endsAt,
				// The room is held for exactly the session's own window. A second pair
				// of fields would be another thing to keep in step, for no benefit the
				// programs asked for.
				reservation: data.reserveRoom ? { startsAt, endsAt, overrideConflicts: false } : undefined
			});
			return { success: true, id: evt.id };
		} catch (err) {
			// `ReservationConflictError` is a 409 and an ordinary answer — the room
			// is taken — not a fault to report as a 500.
			mapDomainError(err);
		}
	}
);

const sessionRef = z.object({
	groupId: z.string().min(1),
	eventId: z.string().min(1)
});

/**
 * Resolve the group, then re-scope the event to it.
 *
 * The event id is the client's. Checking `evt.groupId === group.id` is what
 * stops a leader of one program acting on another's listing — the same shape
 * `publishBandEvent` uses.
 */
async function requireOwnSession(data: { groupId: string; eventId: string }) {
	const { user, group } = await requireGroupRole({ id: data.groupId }, 'admin');
	const evt = await getEventById(data.eventId);
	if (!evt || evt.groupId !== group.id) error(404, 'Session not found');
	return { user, group, evt };
}

export const updateGroupSession = form(
	sessionRef.extend({
		title: z.string().min(1, 'Give the session a name').max(SHORT_TEXT_MAX),
		description: z.string().max(LONG_TEXT_MAX).optional(),
		sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
		startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time'),
		endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick an end time')
	}),
	async (data, issue) => {
		const { group } = await requireOwnSession(data);

		const { startsAt, endsAt } = buildTimeRangeInTz(
			data.sessionDate,
			data.startTime,
			data.endTime,
			DEFAULT_TIMEZONE
		);
		if (endsAt <= startsAt) {
			invalid(issue.endTime('The session has to end after it starts'));
		}

		try {
			await updateSession(data.eventId, group.id, {
				title: data.title,
				description: data.description || null,
				startsAt,
				endsAt
			});
			return { success: true };
		} catch (err) {
			// A moved session can collide with something else in the room. That is
			// a 409 and an ordinary answer, not a fault.
			mapDomainError(err);
		}
	}
);

/**
 * Call a session off. The room goes back with it — see `cancelGroupSession`.
 *
 * Cancelling rather than deleting: the listing may already be on the gig guide
 * and people may have seen it, so it says cancelled rather than vanishing.
 */
export const cancelGroupSession = form(sessionRef, async (data) => {
	const { user, group } = await requireOwnSession(data);
	try {
		await cancelSession(data.eventId, group.id, user.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * Pull a session off the gig guide, or put it back.
 *
 * Sessions publish on create now, so unpublish is the control that matters:
 * without it a leader who wanted a meeting off the public calendar had to
 * cancel it, which also gave the room away.
 */
export const publishGroupSession = form(sessionRef, async (data) => {
	await requireOwnSession(data);
	try {
		await publish(data.eventId);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const unpublishGroupSession = form(sessionRef, async (data) => {
	await requireOwnSession(data);
	try {
		await unpublish(data.eventId);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});
