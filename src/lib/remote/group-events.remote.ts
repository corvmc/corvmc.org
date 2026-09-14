import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireProgramRole } from '$lib/server/group/group-context';
import { DEFAULT_TIMEZONE, LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import { buildDateInTz, buildTimeRangeInTz } from '$lib/server/reservation/timezone';
import { createEventSeries } from '$lib/server/reservation/recurring-series-service';
import { RECURRING_FREQUENCIES } from '$lib/server/db/schema/recurring';
import { readPosterFile, toPosterParam } from '$lib/server/event/poster-file';
import { validateUpload } from '$lib/server/storage';
import { dollarsToCents } from '$lib/utils/event-ticketing';
import {
	cancelGroupSession as cancelSession,
	createGroupEvent,
	getById as getEventById,
	publish,
	unpublish,
	updateGroupSession as updateSession
} from '$lib/server/event/event-service';

/**
 * A club's or committee's sessions — the writes.
 *
 * Reads live on `getMemberGroup`, one round trip for the whole page, which is
 * what `custom/no-concurrent-remote-queries` exists to get.
 */

// This is the one path outside the staff panel that can reserve the room, so
// every write resolves `requireProgramRole(ref, 'admin')` — a leader, of a club
// or committee rather than a band — and the ones taking an event id go through
// `requireOwnSession`, which re-scopes the listing to that group.

// There is no feature flag: `ALL_FLAGS` never held a `groupEvents` entry, and
// flags were retired for long-lived `feature/*` branches.

/**
 * The listing fields a session carries for the same reasons a band's gig does.
 * A program's show can be paid — it just is not sold through CMC's checkout,
 * which is closed to every non-CMC source alike. See `update` in event-service.
 */
const listingFields = {
	doorsTime: z.string().optional(),
	tags: z.string().max(500).optional(),
	externalTicketUrl: z.string().url().optional().or(z.literal('')),
	ticketPriceDollars: z.string().max(12).optional(),
	posterFile: z.instanceof(File).optional()
};

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
		reserveRoom: z.boolean().optional().default(false),
		/**
		 * Repeat. The generator does the rest: `processEventSeries` inherits
		 * `source` and `groupId` from this prototype, publishes each occurrence
		 * because `source !== 'cmc'`, and re-books the room for the same window.
		 */
		recurring: z.boolean().optional().default(false),
		recurringFrequency: z.enum(RECURRING_FREQUENCIES).optional(),
		// 'weekday' is what expresses "third Thursday" rather than "the 17th".
		monthlyMode: z.enum(['weekday', 'monthday']).optional(),
		recurringEndsAt: z
			.string()
			.regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
			.optional(),
		...listingFields
	}),
	async (data, issue) => {
		// Owner or admin, matching the spec's role table: members read the
		// calendar, they do not put things on it. `requireProgramRole`, not
		// `requireGroupRole`: this is the one member-reachable path that holds the
		// room for free, and that privilege travels with `kind`. A band admin
		// reaching it with their own band's id was #714.
		const { user, group } = await requireProgramRole({ id: data.groupId }, 'admin');

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
		if (data.recurring && !data.recurringFrequency) {
			invalid(issue.recurringFrequency('Choose how often it repeats'));
		}

		const listing = readListingFields(data, data.sessionDate);
		if (listing.priceUnparseable) {
			invalid(issue.ticketPriceDollars('Enter a price like 10.00, or leave blank'));
		}
		if (listing.posterReason) invalid(issue.posterFile(listing.posterReason));
		const { doorsAt, tags, externalTicketUrl, ticketPrice, poster } = listing;

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
				doorsAt,
				tags,
				externalTicketUrl,
				ticketPrice,
				reservation: data.reserveRoom ? { startsAt, endsAt, overrideConflicts: false } : undefined,
				posterFile: await toPosterParam(poster)
			});

			// Registered after the event exists, because the series points at it as
			// its prototype. A failure here leaves a real one-off session rather
			// than a half-made series, which is the better of the two.
			if (data.recurring && data.recurringFrequency) {
				await createEventSeries({
					prototypeEventId: evt.id,
					frequency: data.recurringFrequency,
					prototypeStartsAt: startsAt,
					monthlyMode: data.monthlyMode,
					endsAt: data.recurringEndsAt
						? buildDateInTz(data.recurringEndsAt, '23:59', DEFAULT_TIMEZONE)
						: undefined
				});
			}

			return { success: true, id: evt.id };
		} catch (err) {
			// `ReservationConflictError` is a 409 and an ordinary answer — the room
			// is taken — not a fault to report as a 500.
			mapDomainError(err);
		}
	}
);

/**
 * Normalise the listing fields. Pure: the two that can fail report *why*, and
 * each caller raises it on its own field — kit's `issue` object is not worth
 * threading through a helper.
 *
 * `doorsTime` resolves against the session's date in the app's zone, the same
 * way the start and end do.
 */
function readListingFields(
	data: {
		doorsTime?: string;
		tags?: string;
		externalTicketUrl?: string;
		ticketPriceDollars?: string;
		posterFile?: File;
	},
	sessionDate: string
) {
	const ticketPrice = dollarsToCents(data.ticketPriceDollars);
	const poster = readPosterFile(data.posterFile);

	return {
		doorsAt: data.doorsTime
			? buildDateInTz(sessionDate, data.doorsTime, DEFAULT_TIMEZONE)
			: undefined,
		tags: data.tags || undefined,
		externalTicketUrl: data.externalTicketUrl || undefined,
		ticketPrice,
		poster,
		/** `undefined` from `dollarsToCents` means unparseable, not absent. */
		priceUnparseable: ticketPrice === undefined,
		posterReason: poster ? validateUpload(poster) : null
	};
}

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
	const { user, group } = await requireProgramRole({ id: data.groupId }, 'admin');
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
		endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick an end time'),
		/**
		 * Unlike create's, this one has no safe default. The form always renders
		 * the checkbox at the session's current state, so an absent field is an
		 * unticked box and means release — not "leave it alone".
		 */
		reserveRoom: z.boolean().optional().default(false),
		...listingFields
	}),
	async (data, issue) => {
		const { user, group } = await requireOwnSession(data);

		const { startsAt, endsAt } = buildTimeRangeInTz(
			data.sessionDate,
			data.startTime,
			data.endTime,
			DEFAULT_TIMEZONE
		);
		if (endsAt <= startsAt) {
			invalid(issue.endTime('The session has to end after it starts'));
		}

		const listing = readListingFields(data, data.sessionDate);
		if (listing.priceUnparseable) {
			invalid(issue.ticketPriceDollars('Enter a price like 10.00, or leave blank'));
		}
		if (listing.posterReason) invalid(issue.posterFile(listing.posterReason));
		const { doorsAt, tags, externalTicketUrl, ticketPrice, poster } = listing;

		try {
			await updateSession(data.eventId, group.id, user.id, {
				title: data.title,
				description: data.description || null,
				startsAt,
				endsAt,
				reserveRoom: data.reserveRoom,
				// `null` not `undefined` for the cleared ones: undefined means "leave
				// alone" in the service, so an emptied field would never clear.
				doorsAt: doorsAt ?? null,
				tags: tags ?? null,
				externalTicketUrl: externalTicketUrl ?? null,
				ticketPrice: ticketPrice ?? null,
				posterFile: await toPosterParam(poster)
			});
			return { success: true };
		} catch (err) {
			// A session moved into a taken slot, or one asking for a room already
			// held, is a 409 and an ordinary answer rather than a fault.
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
