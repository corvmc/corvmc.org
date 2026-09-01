import { z } from 'zod';
import { invalid } from '@sveltejs/kit';
import { form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireGroupRole } from '$lib/server/group/group-context';
import { DEFAULT_TIMEZONE, LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import { buildTimeRangeInTz } from '$lib/server/reservation/timezone';
import { createGroupEvent } from '$lib/server/event/event-service';

/**
 * A club's or committee's sessions.
 *
 * Reads live on `getMemberGroup`, which returns the sessions with the rest of
 * the page in one round trip — a per-tab query fanned out of a section component
 * is what `docs/checklists/remote-query-fanout.md` exists to stop. What is here
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
