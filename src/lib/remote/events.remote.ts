import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { listRsvpsForUser } from '$lib/server/event/rsvp-service';
import { bandRefColumns, toBandRef, toEventRef } from '$lib/server/entity/refs';
import {
	create,
	update,
	checkRebookNeeded,
	publish,
	unpublishWithNotice,
	remove as removeEvent,
	getDeletionImpact,
	cancel,
	getById,
	listAll as listAllEvents,
	listUpcoming,
	listPast,
	getEventLineup,
	listMemberUpcomingShows,
	listMemberPastShows,
	type MemberShowRow,
	countMemberPastShows
} from '$lib/server/event/event-service';
import {
	getConflictDetails,
	getValidationWarnings
} from '$lib/server/reservation/conflict-service';
import { buildDateInTz, buildTimeRangeInTz } from '$lib/server/reservation/timezone';
import {
	createEventSeries,
	getByEvent,
	getEventSeries,
	cancel as cancelSeries
} from '$lib/server/reservation/recurring-series-service';
import { buildRRule, getOccurrences } from '$lib/server/reservation/rrule-helpers';
import { RECURRING_FREQUENCIES, type RecurringFrequency } from '$lib/server/db/schema/recurring';
import {
	getTicketsRemaining,
	getTicketsSold,
	getEventTickets,
	getUserTickets,
	getTicketsByPurchase,
	createTickets,
	checkIn,
	cancelTicket as cancelTicketService
} from '$lib/server/ticket/ticket-service';
import {
	createRsvp,
	cancelRsvp as cancelRsvpService,
	getUserRsvp,
	countRsvps
} from '$lib/server/event/rsvp-service';
import { publicEventStatuses, eventStatuses } from '$lib/server/db/schema/event';
import { getStanding } from '$lib/server/moderation/standing-service';
import { isSustainingMember as checkSustainingMember } from '$lib/server/finance/subscription-service';
import { checkout } from '$lib/server/finance/payment-service';
import { InsufficientCreditsError } from '$lib/server/finance/credit-service';
import { buildLineItem } from '$lib/server/finance/product-config-service';
import { resolveImageUrl } from '$lib/server/storage';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, like, not, inArray, notInArray, sql } from 'drizzle-orm';
import { event, createEventSchema, eventSources } from '$lib/server/db/schema/event';
import { band } from '$lib/server/db/schema/band';
import { isFeatureEnabled } from '$lib/server/feature-flags';
import { randomUUID } from 'crypto';
import { hasEventEnded } from '$lib/utils/event-time';
import { DEFAULT_TIMEZONE, SEARCH_LIMIT, SHORT_TEXT_MAX } from '$lib/config';
import { formatDateShortYear } from '$lib/utils/format';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Deliberately unguarded despite the name: returns only the same public event
 * fields the public listing shows (no attendee, ticket or purchaser data).
 */
export const getMemberEvents = query(async () => {
	const [upcoming, past] = await Promise.all([listUpcoming(), listPast(12)]);
	const mapEvent = (e: (typeof upcoming)[number]) => ({
		id: e.id,
		title: e.title,
		startsAt: e.startsAt,
		endsAt: e.endsAt,
		doorsAt: e.doorsAt ?? null,
		tags: e.tags as string | null,
		ticketingEnabled: e.ticketingEnabled,
		ticketPrice: e.ticketPrice,
		// Without the ticket link a card can't tell an off-site sale from a free
		// show, and an unpriced external gig would advertise itself as free.
		externalTicketUrl: e.externalTicketUrl,
		posterUrl: resolveImageUrl(e.posterKey)
	});
	return { upcoming: upcoming.map(mapEvent), past: past.map(mapEvent) };
});

export const getMemberTickets = query(async () => {
	const currentUser = requireUser();
	const tickets = await getUserTickets(currentUser.id);

	const eventIds = [...new Set(tickets.map((t) => t.eventId))];
	// Tickets only exist for platform-ticketed events, which are always CMC —
	// bands never sell through our checkout — so `event_cmc_needs_end` guarantees
	// an end time here. Narrowed at this boundary so the ticket stub and QR modal
	// keep their non-null contract.
	let eventMap: Record<string, { title: string; startsAt: Date; endsAt: Date }> = {};

	if (eventIds.length > 0) {
		const events = await db
			.select({ id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt })
			.from(event)
			.where(inArray(event.id, eventIds));

		eventMap = Object.fromEntries(
			events
				.filter((e): e is typeof e & { endsAt: Date } => e.endsAt != null)
				.map((e) => [e.id, { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt }])
		);
	}

	return tickets.map((t) => {
		const evt = eventMap[t.eventId];
		return {
			id: t.id,
			eventId: t.eventId,
			code: t.code,
			status: t.status,
			attendeeName: t.attendeeName,
			checkedInAt: t.checkedInAt ?? null,
			createdAt: t.createdAt,
			event: evt ?? null
		};
	});
});

export const getMemberEventDetail = query(z.string(), async (id) => {
	const { locals } = getRequestEvent();
	const evt = await getById(id);
	if (!evt) throw error(404, 'Event not found');
	const remaining = evt.ticketingEnabled ? await getTicketsRemaining(id) : null;
	const isSustainingMember = locals.user ? await checkSustainingMember(locals.user.id) : false;

	// Sold is derived from remaining only when the event is both ticketed and capped;
	// otherwise the capacity bar isn't shown so the count isn't needed.
	const sold =
		evt.ticketQuantity != null && remaining != null ? evt.ticketQuantity - remaining : null;

	// Non-ticketed events use the lightweight RSVP join table for headcount.
	const rsvpCount = evt.ticketingEnabled ? 0 : await countRsvps(id);
	const myRsvp =
		!evt.ticketingEnabled && locals.user ? Boolean(await getUserRsvp(id, locals.user.id)) : false;

	// "More shows" tail: other upcoming events, excluding this one.
	const upcomingRows = await listUpcoming();
	const upcoming = upcomingRows
		.filter((e) => e.id !== id)
		.slice(0, 6)
		.map((e) => ({
			id: e.id,
			title: e.title,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			doorsAt: e.doorsAt ?? null,
			tags: e.tags as string | null,
			ticketingEnabled: e.ticketingEnabled,
			ticketPrice: e.ticketPrice,
			externalTicketUrl: e.externalTicketUrl,
			posterUrl: resolveImageUrl(e.posterKey)
		}));

	return {
		event: {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			startsAt: evt.startsAt,
			endsAt: evt.endsAt,
			doorsAt: evt.doorsAt ?? null,
			location: evt.location,
			tags: evt.tags as string | null,
			posterUrl: resolveImageUrl(evt.posterKey),
			ticketingEnabled: evt.ticketingEnabled,
			ticketPrice: evt.ticketPrice,
			ticketQuantity: evt.ticketQuantity,
			// An externally ticketed event still takes RSVPs here; the page needs
			// the link to send members to whoever is actually selling.
			source: evt.source,
			externalTicketUrl: evt.externalTicketUrl
		},
		remaining,
		sold,
		isSustainingMember,
		myRsvp,
		rsvpCount,
		upcoming
	};
});

/** Next few CMC shows as poster cards — the /events hero and home-page section. */
export const getPublicEvents = query(async () => {
	const upcoming = await listUpcoming(3);
	return {
		upcoming: upcoming.map((e) => ({
			id: e.id,
			title: e.title,
			description: e.description,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			doorsAt: e.doorsAt ?? null,
			tags: e.tags as string | null,
			posterUrl: resolveImageUrl(e.posterKey),
			ticketingEnabled: e.ticketingEnabled,
			ticketPrice: e.ticketPrice,
			externalTicketUrl: e.externalTicketUrl
		}))
	};
});

export const getPublicEventDetail = query(z.string(), async (id) => {
	const { locals } = getRequestEvent();
	const evt = await getById(id);
	if (!evt) throw error(404, 'Event not found');
	// Cancelled events still render, with a banner and no buy affordances. A
	// shared link to a cancelled show must say "cancelled" rather than behave as
	// though the show never existed — the people following that link are exactly
	// the ones who need to know. Draft, pending_review and rejected stay 404.
	if (!(publicEventStatuses as readonly string[]).includes(evt.status)) {
		throw error(404, 'Event not found');
	}

	let bandInfo: { name: string; slug: string } | null = null;
	if (evt.bandId) {
		const [row] = await db
			.select({ name: band.name, slug: band.slug })
			.from(band)
			.where(eq(band.id, evt.bandId))
			.limit(1);
		bandInfo = row ?? null;
	}

	const lineup = await getEventLineup(id);
	const remaining = evt.ticketingEnabled ? await getTicketsRemaining(id) : null;
	const sold =
		evt.ticketQuantity != null && remaining != null ? evt.ticketQuantity - remaining : null;

	// Non-ticketed events use the lightweight RSVP join table for headcount.
	const rsvpCount = evt.ticketingEnabled ? 0 : await countRsvps(id);

	// Sustaining members see the discounted price; anonymous visitors don't.
	const isSustainingMember = locals.user ? await checkSustainingMember(locals.user.id) : false;

	const isPast = hasEventEnded(evt.startsAt, evt.endsAt);

	// "More shows" tail: other upcoming events, excluding this one.
	const upcomingRows = await listUpcoming();
	const upcoming = upcomingRows
		.filter((e) => e.id !== id)
		.slice(0, 6)
		.map((e) => ({
			id: e.id,
			title: e.title,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			doorsAt: e.doorsAt ?? null,
			tags: e.tags as string | null,
			ticketingEnabled: e.ticketingEnabled,
			ticketPrice: e.ticketPrice,
			externalTicketUrl: e.externalTicketUrl,
			posterUrl: resolveImageUrl(e.posterKey)
		}));

	return {
		event: {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			startsAt: evt.startsAt,
			endsAt: evt.endsAt,
			doorsAt: evt.doorsAt ?? null,
			location: evt.location,
			tags: evt.tags as string | null,
			posterUrl: resolveImageUrl(evt.posterKey),
			ticketingEnabled: evt.ticketingEnabled,
			ticketPrice: evt.ticketPrice,
			ticketQuantity: evt.ticketQuantity,
			source: evt.source,
			status: evt.status,
			externalTicketUrl: evt.externalTicketUrl,
			bandName: bandInfo?.name ?? null,
			bandSlug: bandInfo?.slug ?? null,
			// The whole bill, every status. Only `confirmed` entries carry a slug
			// and therefore link out — an unconfirmed credit must not push traffic
			// to a band that hasn't agreed to be listed.
			lineup: lineup.map((l) => ({
				id: l.id,
				name: l.name,
				slug: l.status === 'confirmed' ? l.bandSlug : null
			}))
		},
		remaining,
		sold,
		rsvpCount,
		isSustainingMember,
		isPast,
		isAuthenticated: !!locals.user,
		// Cancelled listings aren't reportable: they're already on their way
		// off the guide, so opening them up only widens the id-probing surface
		// the moderation spec closed.
		canReport: evt.status === 'published' && (await isFeatureEnabled('contentFlags')),
		upcoming
	};
});

export const getPublicTicketPage = query(z.string(), async (id) => {
	const { locals } = getRequestEvent();
	const evt = await getById(id);
	if (!evt) throw error(404, 'Event not found');
	if (evt.status !== 'published') throw error(404, 'Event not found');
	if (!evt.ticketingEnabled) throw error(404, 'Tickets not available for this event');
	// CMC only sells shows CMC produces (see `update()` in event-service): a
	// band's gig or a member's community listing would put money in CMC's Stripe
	// account with no payout path back to whoever is actually putting it on.
	// Checked on source so a row written before the rule still cannot reach
	// checkout.
	if (evt.source !== 'cmc') throw error(404, 'Tickets not available for this event');

	const remaining = await getTicketsRemaining(id);

	// DB snapshot is the single membership source (matches the purchase path).
	const isSustainingMember = locals.user ? await checkSustainingMember(locals.user.id) : false;

	const posterUrl = resolveImageUrl(evt.posterKey);

	return {
		event: {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			startsAt: evt.startsAt,
			endsAt: evt.endsAt,
			doorsAt: evt.doorsAt ?? null,
			ticketPrice: evt.ticketPrice,
			ticketQuantity: evt.ticketQuantity
		},
		remaining,
		isSustainingMember,
		posterUrl,
		isAuthenticated: !!locals.user
	};
});

/**
 * Deliberately unguarded: the post-checkout success page must work for guest
 * buyers who have no account. `purchaseId` is a randomUUID minted at checkout,
 * so it acts as an unguessable capability token for that one purchase. Do not
 * widen this to accept an enumerable id (event id, email, ticket code).
 */
export const getTicketPurchaseSuccess = query(
	z.object({ eventId: z.string(), purchaseId: z.string() }),
	async ({ eventId, purchaseId }) => {
		const evt = await getById(eventId);
		if (!evt) throw error(404, 'Event not found');

		const tickets = await getTicketsByPurchase(purchaseId);
		if (tickets.length === 0) throw error(404, 'Purchase not found');

		return {
			event: {
				id: evt.id,
				title: evt.title,
				startsAt: evt.startsAt,
				endsAt: evt.endsAt,
				doorsAt: evt.doorsAt ?? null
			},
			tickets: tickets.map((t) => ({
				id: t.id,
				code: t.code,
				attendeeName: t.attendeeName,
				attendeeEmail: t.attendeeEmail,
				status: t.status
			}))
		};
	}
);

export const getStaffCheckIn = query(z.string(), async (id) => {
	await requireStaff();
	const evt = await getById(id);
	if (!evt) throw error(404, 'Event not found');
	if (!evt.ticketingEnabled) throw error(400, 'Ticketing not enabled for this event');

	const [tickets, sold] = await Promise.all([getEventTickets(id), getTicketsSold(id)]);

	const checkedIn = tickets.filter((t) => t.status === 'checked_in').length;

	return {
		event: {
			id: evt.id,
			title: evt.title,
			startsAt: evt.startsAt,
			ticketQuantity: evt.ticketQuantity
		},
		tickets: tickets
			.filter((t) => t.status === 'valid' || t.status === 'checked_in')
			.map((t) => ({
				id: t.id,
				attendeeName: t.attendeeName,
				attendeeEmail: t.attendeeEmail,
				code: t.code,
				status: t.status,
				checkedInAt: t.checkedInAt
			})),
		stats: { sold, checkedIn }
	};
});

export const getStaffEvents = query(
	z.object({
		source: z.enum(eventSources).optional(),
		status: z.enum(eventStatuses).optional(),
		page: z.number().optional()
	}),
	async (filters) => {
		await requireStaff();
		const { rows, pagination } = await listAllEvents(
			{ source: filters.source, status: filters.status },
			{ page: filters.page ?? 1, pageSize: 50 }
		);
		return {
			rows: rows.map((e) => ({
				...e,
				// The listing's own status is the row's and keeps its column, so the
				// ref carries none — two marks for one fact reads as two facts.
				ref: toEventRef({ id: e.id, title: e.title, startsAt: e.startsAt }),
				// `event.bandId` is who manages the listing; the left join is already
				// here for the byline.
				band: toBandRef({ id: e.bandId, name: e.bandName, slug: e.bandSlug })
			})),
			pagination
		};
	}
);

/**
 * Staff: event lookup for anything that hangs off a show — today, the volunteer
 * shift forms.
 *
 * Two departures from `listAll`, which is the other staff-facing event read:
 *
 *  - **Nearest-in-time first, not newest first.** A venue has five rows called
 *    "Open Mic Night"; ordering by `startsAt` descending hands back the one
 *    furthest in the future, which is never the one the staffer meant. Sorting
 *    by distance from now puts next Thursday's ahead of next April's, and still
 *    reaches backwards for a show that already happened.
 *  - **Cancelled and rejected are excluded**, because you do not staff a show
 *    that is not happening. `listAll` keeps them; it is an admin index, and
 *    this is a picker.
 *
 * The community-draft exclusion is `listAll`'s and carries its reasoning: a
 * draft listing is a member's private working copy, and a staffer browsing
 * events has no business reading it.
 */
export const searchEvents = query(z.string(), async (q) => {
	await requireStaff();
	if (!q || q.length < 2) return [];

	const pattern = `%${q}%`;
	const rows = await db
		.select({ id: event.id, title: event.title, startsAt: event.startsAt })
		.from(event)
		.where(
			and(
				like(event.title, pattern),
				notInArray(event.status, ['cancelled', 'rejected']),
				not(and(eq(event.source, 'community'), eq(event.status, 'draft'))!)
			)
		)
		.orderBy(sql`abs(${event.startsAt} - unixepoch())`)
		.limit(SEARCH_LIMIT);

	// The date arrives as a string because SearchSelect renders its description
	// field verbatim — and it is formatted here so it lands in club time rather
	// than whatever timezone the staffer's laptop is set to.
	return rows.map((e) => ({ id: e.id, title: e.title, when: formatDateShortYear(e.startsAt) }));
});

export const getStaffEventDetail = query(z.string(), async (id) => {
	await requireStaff();

	const evt = await getById(id);
	if (!evt) throw error(404, 'Event not found');

	const [creator] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, evt.createdByUserId))
		.limit(1);

	// Band attribution: staff need to see whose gig this is before editing or
	// pulling it, since band events sit in the same list as CMC ones.
	let bookingBand: { id: string; name: string; slug: string } | null = null;
	if (evt.bandId) {
		const [row] = await db
			.select(bandRefColumns())
			.from(band)
			.where(eq(band.id, evt.bandId))
			.limit(1);
		if (row) bookingBand = { id: row.id, name: row.name, slug: row.slug };
	}

	let linkedReservation: { id: string; status: string; startsAt: Date; endsAt: Date } | null = null;
	if (evt.reservationId) {
		const [res] = await db
			.select({
				id: reservation.id,
				status: reservation.status,
				startsAt: reservation.startsAt,
				endsAt: reservation.endsAt
			})
			.from(reservation)
			.where(eq(reservation.id, evt.reservationId))
			.limit(1);
		if (res) linkedReservation = res;
	}

	const posterUrl = resolveImageUrl(evt.posterKey);

	let ticketStats: { sold: number; remaining: number | null } | null = null;
	let tickets: {
		id: string;
		purchaseId: string | null;
		attendeeName: string;
		attendeeEmail: string;
		code: string;
		status: string;
		checkedInAt: Date | null;
		createdAt: Date;
	}[] = [];

	if (evt.ticketingEnabled) {
		const [sold, remaining, allTickets] = await Promise.all([
			getTicketsSold(evt.id),
			getTicketsRemaining(evt.id),
			getEventTickets(evt.id)
		]);
		ticketStats = { sold, remaining };
		tickets = allTickets.map((t) => ({
			id: t.id,
			purchaseId: t.purchaseId,
			attendeeName: t.attendeeName,
			attendeeEmail: t.attendeeEmail,
			code: t.code,
			status: t.status,
			checkedInAt: t.checkedInAt,
			createdAt: t.createdAt
		}));
	}

	return {
		event: {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			startsAt: evt.startsAt,
			endsAt: evt.endsAt,
			doorsAt: evt.doorsAt,
			publishedAt: evt.publishedAt,
			createdAt: evt.createdAt,
			updatedAt: evt.updatedAt,
			status: evt.status,
			tags: evt.tags,
			reservationId: evt.reservationId,
			ticketingEnabled: evt.ticketingEnabled,
			ticketPrice: evt.ticketPrice,
			ticketQuantity: evt.ticketQuantity,
			posterKey: evt.posterKey,
			source: evt.source,
			bandId: evt.bandId,
			location: evt.location,
			externalTicketUrl: evt.externalTicketUrl
		},
		band: bookingBand,
		/** The same band, ready to render. `band` stays for the fields the form reads. */
		bandRef: bookingBand ? toBandRef(bookingBand) : null,
		posterUrl,
		creator,
		// Standing only matters for a community listing, and only staff see it.
		// It's what tells a reviewer whether this member is here because of a
		// past problem or because they're new.
		submitterStanding:
			evt.source === 'community' ? await getStanding(evt.createdByUserId, 'community_event') : null,
		submitterId: evt.createdByUserId,
		linkedReservation,
		ticketStats,
		tickets
	};
});

export const checkConflicts = query(
	z.object({
		date: z.string(),
		startTime: z.string(),
		endTime: z.string(),
		excludeReservationId: z.string().optional()
	}),
	async ({ date, startTime, endTime, excludeReservationId }) => {
		await requireStaff();
		const { startsAt, endsAt } = buildTimeRangeInTz(date, startTime, endTime, DEFAULT_TIMEZONE);

		const conflicts = await getConflictDetails(startsAt, endsAt);
		const validationWarnings = await getValidationWarnings(startsAt, endsAt);

		// Drop the event's own hold — re-timing an event must not report it as
		// conflicting with itself. The old test was `!('id' in c)`, and
		// getConflictDetails never returned an id, so it was always true and
		// nothing was ever filtered: every event with a hold showed a phantom
		// conflict, which armed "Override conflicts" and made the save skip the
		// real double-booking check.
		const filtered = excludeReservationId
			? conflicts.filter((c) => c.type !== 'reservation' || c.id !== excludeReservationId)
			: conflicts;

		return { conflicts: filtered, validationWarnings };
	}
);

export const checkRebook = query(
	z.object({
		eventId: z.string(),
		newStartsAt: z.string(),
		newEndsAt: z.string()
	}),
	async ({ eventId, newStartsAt, newEndsAt }) => {
		await requireStaff();
		const result = await checkRebookNeeded(eventId, new Date(newStartsAt), new Date(newEndsAt));
		return {
			needed: result.needed,
			reason: result.reason,
			currentReservation: result.currentReservation
				? {
						id: result.currentReservation.id,
						startsAt: result.currentReservation.startsAt,
						endsAt: result.currentReservation.endsAt
					}
				: null
		};
	}
);

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const createEvent = form(createEventSchema, async (data, issue) => {
	const staff = await requireStaff();

	const ticketingEnabled = data.ticketingEnabled;
	const reserveSpace = data.reserveSpace;
	const overrideConflicts = data.overrideConflicts;
	const ticketPrice = data.ticketPrice ? parseInt(data.ticketPrice, 10) : undefined;
	const ticketQuantity = data.ticketQuantity ? parseInt(data.ticketQuantity, 10) : undefined;

	if (!data.title) {
		invalid(issue.title('Title is required'));
	}

	const tz = DEFAULT_TIMEZONE;
	// One date field covers both times, so an end before the start means the show
	// runs past midnight and the range rolls onto the next day.
	const { startsAt, endsAt } = buildTimeRangeInTz(
		data.eventDate,
		data.eventStartTime,
		data.eventEndTime,
		tz
	);
	const doorsAt = data.doorsTime ? buildDateInTz(data.eventDate, data.doorsTime, tz) : undefined;

	// The reservation times are an optional override for setup and teardown, not a
	// precondition: without them the space is held for the event's own window.
	// Gating on them meant a submission that checked the box but sent no times
	// created the event with no reservation and no error.
	//
	// All-or-nothing, because buildTimeRangeInTz reads an end before the start as
	// an overnight range: pairing a supplied 23:00 start with a defaulted 22:00
	// end would roll the end onto the next day and hold the room for 23 hours.
	const customWindow = !!(data.reservationStartTime && data.reservationEndTime);
	const reservation = reserveSpace
		? {
				...buildTimeRangeInTz(
					data.eventDate,
					customWindow ? data.reservationStartTime! : data.eventStartTime,
					customWindow ? data.reservationEndTime! : data.eventEndTime,
					tz
				),
				overrideConflicts
			}
		: undefined;

	const event = await create({
		title: data.title,
		description: data.description || undefined,
		startsAt,
		endsAt,
		doorsAt,
		tags: data.tags || undefined,
		ticketingEnabled,
		ticketPrice: ticketingEnabled ? ticketPrice : undefined,
		ticketQuantity: ticketingEnabled ? ticketQuantity : undefined,
		createdByUserId: staff.id,
		reservation
	});

	// Recurring: register a series so the generation job materializes occurrences.
	if (data.recurring && data.recurringFrequency) {
		await createEventSeries({
			prototypeEventId: event.id,
			frequency: data.recurringFrequency as RecurringFrequency,
			prototypeStartsAt: startsAt,
			monthlyMode: data.monthlyMode,
			endsAt: data.recurringEndsAt ? buildDateInTz(data.recurringEndsAt, '23:59', tz) : undefined
		});
	}

	return { eventId: event.id };
});

/** Preview the next handful of occurrences for a recurring event series. */
export const previewRecurringEvents = query(
	z.object({
		date: z.string(),
		startTime: z.string(),
		frequency: z.enum(RECURRING_FREQUENCIES),
		monthlyMode: z.enum(['weekday', 'monthday']).optional()
	}),
	async ({ date, startTime, frequency, monthlyMode }) => {
		const startsAt = buildDateInTz(date, startTime, DEFAULT_TIMEZONE);
		const rruleString = buildRRule(startsAt, frequency, monthlyMode ?? 'weekday');
		const now = new Date();
		const windowEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
		const occurrences = getOccurrences(rruleString, now, windowEnd);
		return {
			dates: occurrences.slice(0, 8).map((d) => d.toISOString()),
			totalInWindow: occurrences.length
		};
	}
);

/** The recurring series an event belongs to, if any (staff). */
export const getEventRecurringSeries = query(z.string(), async (eventId) => {
	await requireStaff();
	const series = await getByEvent(eventId);
	if (!series) return null;
	return getEventSeries(series.id);
});

/** Stop a recurring event series; existing occurrences remain (staff). */
export const cancelEventSeries = form(z.object({ seriesId: z.string() }), async (data) => {
	await requireStaff();
	await cancelSeries(data.seriesId);
	return { success: true };
});

export const updateEvent = form(
	z.object({
		eventId: z.string().min(1),
		title: z.string().optional(),
		description: z.string().optional(),
		tags: z.string().optional(),
		eventDate: z.string().optional(),
		eventStartTime: z.string().optional(),
		eventEndTime: z.string().optional(),
		doorsTime: z.string().optional(),
		// Band gigs live off these two — without them staff can see a wrong venue
		// or a dead ticket link on the guide and have no way to fix it.
		location: z.string().max(SHORT_TEXT_MAX).optional(),
		externalTicketUrl: z.string().max(500).optional(),
		ticketingEnabled: z.boolean().optional(),
		ticketPrice: z.string().optional(),
		ticketQuantity: z.string().optional(),
		rebookReservation: z.boolean().default(false),
		reservationStartTime: z.string().optional(),
		reservationEndTime: z.string().optional(),
		overrideConflicts: z.boolean().default(false)
	}),
	async (data) => {
		const staff = await requireStaff();
		const tz = DEFAULT_TIMEZONE;

		const ticketingEnabled = data.ticketingEnabled;
		const rebookReservation = data.rebookReservation;
		const overrideConflicts = data.overrideConflicts;

		const updateParams: Parameters<typeof update>[1] = {};

		if (data.title !== undefined && data.title !== '') updateParams.title = data.title;
		if (data.description !== undefined) updateParams.description = data.description || null;
		if (data.tags !== undefined) updateParams.tags = data.tags || null;
		if (data.location !== undefined) updateParams.location = data.location || null;
		if (data.externalTicketUrl !== undefined) {
			updateParams.externalTicketUrl = data.externalTicketUrl || null;
		}
		if (ticketingEnabled !== undefined) updateParams.ticketingEnabled = ticketingEnabled;
		if (data.ticketPrice !== undefined) {
			updateParams.ticketPrice = data.ticketPrice ? parseInt(data.ticketPrice, 10) : null;
		}
		if (data.ticketQuantity !== undefined) {
			updateParams.ticketQuantity = data.ticketQuantity ? parseInt(data.ticketQuantity, 10) : null;
		}

		// Build Date objects if date/time fields provided. One date field covers both
		// times, so an end before the start means the show runs past midnight and the
		// range rolls onto the next day.
		if (data.eventDate && data.eventStartTime && data.eventEndTime) {
			const range = buildTimeRangeInTz(data.eventDate, data.eventStartTime, data.eventEndTime, tz);
			updateParams.startsAt = range.startsAt;
			updateParams.endsAt = range.endsAt;
		}

		if (data.doorsTime !== undefined) {
			updateParams.doorsAt =
				data.doorsTime && data.eventDate ? buildDateInTz(data.eventDate, data.doorsTime, tz) : null;
		}

		// Hold the space, or move the existing hold. Same rules as createEvent: the
		// reservation times are an optional override for setup and teardown, not a
		// precondition, and they are all-or-nothing because buildTimeRangeInTz reads
		// an end before the start as an overnight range — a supplied 23:00 start
		// against a defaulted 22:00 end would roll over and hold the room 23 hours.
		//
		// Gating on the times is what made this a silent no-op: the box was ticked,
		// the event saved, and no space was ever held. Same defect the create path
		// carried until #206.
		if (rebookReservation) {
			const customWindow = !!(data.reservationStartTime && data.reservationEndTime);
			const startTime = customWindow ? data.reservationStartTime! : data.eventStartTime;
			const endTime = customWindow ? data.reservationEndTime! : data.eventEndTime;

			// The edit form always submits the event's date and times, so this only
			// trips on a malformed payload. Failing loudly beats booking nothing.
			if (!data.eventDate || !startTime || !endTime) {
				error(400, 'A date and time range are required to hold the space');
			}

			const reservationRange = buildTimeRangeInTz(data.eventDate, startTime, endTime, tz);
			updateParams.rebook = {
				userId: staff.id,
				reservationStartsAt: reservationRange.startsAt,
				reservationEndsAt: reservationRange.endsAt,
				overrideConflicts
			};
		}

		await update(data.eventId, updateParams);
		return { success: true };
	}
);

export const publishEvent = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();
	await publish(data.id);
	return { success: true };
});

export const unpublishEvent = form(
	z.object({
		id: z.string().min(1),
		// Optional, because unpublishing a CMC event notifies nobody and requiring
		// a reason there is pure friction. It is passed through whenever it is
		// given: community listings and band gigs both email whoever posted them,
		// and this endpoint had no way to say why at all — the member got "your
		// listing was taken down" and a blank space where the reason goes.
		// 1000 matches `rejectCommunityEvent`, which writes the same
		// `event.reviewNotes` column.
		notes: z.string().trim().max(1000).optional()
	}),
	async (data) => {
		await requireStaff();
		// Band-sourced events notify the band's admins — pulling a gig silently is
		// the one unpublish that needs a word back to whoever posted it.
		await unpublishWithNotice(data.id, { notes: data.notes });
		return { success: true };
	}
);

export const cancelEvent = form(z.object({ id: z.string().min(1) }), async (data) => {
	const staff = await requireStaff();
	await cancel(data.id, staff.id);
	return { success: true };
});

/**
 * What a delete would destroy. Drives the confirmation copy, so a staffer can
 * tell a mistake from a real event before it is gone.
 */
export const getEventDeletionImpact = query(z.string(), async (id) => {
	await requireStaff();
	return getDeletionImpact(id);
});

export const deleteEvent = form(z.object({ id: z.string().min(1) }), async (data) => {
	const staff = await requireStaff();
	try {
		await removeEvent(data.id, staff.id);
	} catch (err) {
		// The ticket refusal is a business rule with a written explanation, not an
		// internal fault — surfacing it as a 500 would hide the sentence that
		// tells the staffer to cancel instead.
		const message = err instanceof Error ? err.message : 'Could not delete this event';
		throw error(message.includes('tickets') ? 409 : 500, message);
	}
	void getStaffEvents({}).refresh();
	return { success: true };
});

export const compTickets = form(
	z.object({
		eventId: z.string().min(1),
		attendeeName: z.string().min(1),
		attendeeEmail: z.string().min(1),
		quantity: z.string().transform(Number)
	}),
	async (data, issue) => {
		await requireStaff();

		const issues: Parameters<typeof invalid> = [];
		if (!data.attendeeName) {
			issues.push(issue.attendeeName('Name is required'));
		}
		if (!data.attendeeEmail) {
			issues.push(issue.attendeeEmail('Email is required'));
		}
		if (isNaN(data.quantity) || data.quantity < 1 || data.quantity > 50) {
			issues.push(issue.quantity('Quantity must be between 1 and 50'));
		}
		if (issues.length) invalid(...issues);

		const remaining = await getTicketsRemaining(data.eventId);
		if (remaining !== null && data.quantity > remaining) {
			throw error(400, `Only ${remaining} ticket(s) remaining`);
		}

		await createTickets({
			eventId: data.eventId,
			purchaseId: `comp-${crypto.randomUUID()}`,
			quantity: data.quantity,
			attendeeName: data.attendeeName,
			attendeeEmail: data.attendeeEmail,
			status: 'valid'
		});

		return { success: true };
	}
);

export const cancelTicket = form(
	z.object({
		ticketId: z.string().min(1)
	}),
	async (data) => {
		await requireStaff();
		await cancelTicketService(data.ticketId);
		return { success: true };
	}
);

export const checkInTicket = form(z.object({ ticketId: z.string().min(1) }), async (data) => {
	const staff = await requireStaff();
	await checkIn(data.ticketId, staff.id);
	return { success: true };
});

// A single field issue as constructed by a form handler's `issue` helper. Note that
// constructing one does nothing on its own — it only takes effect when handed to
// `invalid()`, which throws.
type FormIssue = Parameters<typeof invalid>[number];

// Resolves the attendee's name and email for a ticket/RSVP form. Logged-in users don't
// have to re-type their details — their account values fill in any field left blank —
// while guests must still supply both. Returns any validation issues rather than
// throwing, so the caller can report them alongside its own (e.g. quantity) in one pass.
function resolveAttendee(
	data: { attendeeName?: string; attendeeEmail?: string },
	user: { name?: string | null; email?: string | null } | undefined,
	issue: {
		attendeeName: (msg: string) => FormIssue;
		attendeeEmail: (msg: string) => FormIssue;
	}
): { name: string; email: string; issues: FormIssue[] } {
	const name = (data.attendeeName ?? '').trim() || user?.name?.trim() || '';
	const email = (data.attendeeEmail ?? '').trim() || user?.email?.trim() || '';

	const issues: FormIssue[] = [];
	if (!name) issues.push(issue.attendeeName('Name is required'));
	if (!email) {
		issues.push(issue.attendeeEmail('Email is required'));
	} else if (!z.string().email().safeParse(email).success) {
		issues.push(issue.attendeeEmail('Valid email is required'));
	}

	return { name, email, issues };
}

// Claim a seat at a free event we're ticketing. This is NOT the same as an RSVP:
// it issues real `ticket` rows with codes, counts against `ticketQuantity`, and
// works at door check-in — it just skips Stripe because the price is zero. The
// headcount-only flow is `rsvpToEvent` below.
export const claimFreeTicket = form(
	z.object({
		eventId: z.string(),
		quantity: z.string().transform(Number),
		attendeeName: z.string().optional(),
		attendeeEmail: z.string().optional()
	}),
	async (data, issue) => {
		const { locals } = getRequestEvent();

		const issues: FormIssue[] = [];
		if (isNaN(data.quantity) || data.quantity < 1 || data.quantity > 10) {
			issues.push(issue.quantity('Quantity must be between 1 and 10'));
		}

		// Logged-in attendees needn't re-enter their details; fall back to their account.
		const attendee = resolveAttendee(data, locals.user, issue);
		issues.push(...attendee.issues);
		if (issues.length) invalid(...issues);

		const evt = await getById(data.eventId);
		if (!evt) throw error(404, 'Event not found');
		if (evt.status !== 'published') throw error(400, 'Event is not published');
		if (!evt.ticketingEnabled) throw error(400, 'Tickets not available');
		if (evt.ticketPrice && evt.ticketPrice > 0) throw error(400, 'This is a paid event');
		// Mints a real ticket row with a code and capacity, so it falls under the
		// same rule as a paid purchase: CMC does not issue tickets for a show it
		// doesn't produce, at any price. Unreachable while `update()` holds — a
		// band or community row cannot have `ticketingEnabled` — but this is the
		// ticket-minting call, so it does not lean on that. (The headcount RSVP
		// below is allowed, deliberately: it takes no money and issues no code.)
		if (evt.source !== 'cmc') throw error(400, 'Tickets not available');

		const remaining = await getTicketsRemaining(data.eventId);
		if (remaining !== null && data.quantity > remaining) {
			throw error(
				400,
				remaining === 0 ? 'This event is full' : `Only ${remaining} spots remaining`
			);
		}

		const purchaseId = `rsvp-${randomUUID()}`;

		await createTickets({
			eventId: evt.id,
			purchaseId,
			quantity: data.quantity,
			userId: locals.user?.id ?? undefined,
			attendeeName: attendee.name,
			attendeeEmail: attendee.email,
			status: 'valid'
		});

		return { redirectUrl: `/events/${evt.id}/tickets/success?purchase_id=${purchaseId}` };
	}
);

// The headcount RSVP: a lightweight join row, no code, no check-in, no capacity,
// one per member (idempotent). Distinct from `claimFreeTicket` above, which mints
// a real ticket. This is the right flow for anything we don't sell — free shows,
// door-price shows, and externally ticketed gigs, where the ticket is bought
// somewhere else and all we're recording is who's coming.
export const rsvpToEvent = form(
	z.object({
		eventId: z.string(),
		attendeeName: z.string().min(1, 'Name is required'),
		attendeeEmail: z.string().email('Valid email is required')
	}),
	async (data) => {
		const user = requireUser();

		const evt = await getById(data.eventId);
		if (!evt) throw error(404, 'Event not found');
		if (evt.status !== 'published') throw error(400, 'Event is not published');
		if (evt.ticketingEnabled) throw error(400, 'This event uses tickets, not RSVPs');
		// Band gigs are deliberately allowed here. An RSVP is a headcount row, not
		// a ticket — it takes no money and issues no code — so it is unaffected by
		// the rule that CMC never sells a band's gig.

		await createRsvp({
			eventId: evt.id,
			userId: user.id,
			attendeeName: data.attendeeName,
			attendeeEmail: data.attendeeEmail
		});

		return { success: true };
	}
);

export const cancelRsvp = form(z.object({ eventId: z.string() }), async (data) => {
	const user = requireUser();
	await cancelRsvpService(data.eventId, user.id);
	return { success: true };
});

export const purchaseTickets = form(
	z.object({
		eventId: z.string(),
		quantity: z.string().transform(Number),
		attendeeName: z.string().optional(),
		attendeeEmail: z.string().optional(),
		coverFees: z.boolean().default(false)
	}),
	async (data, issue) => {
		const { locals, url } = getRequestEvent();

		const issues: FormIssue[] = [];
		if (isNaN(data.quantity) || data.quantity < 1 || data.quantity > 10) {
			issues.push(issue.quantity('Quantity must be between 1 and 10'));
		}

		// Logged-in buyers needn't re-enter their details; fall back to their account.
		const attendee = resolveAttendee(data, locals.user, issue);
		issues.push(...attendee.issues);
		if (issues.length) invalid(...issues);

		const evt = await getById(data.eventId);
		if (!evt) throw error(404, 'Event not found');
		if (evt.status !== 'published') throw error(400, 'Event is not published');
		if (!evt.ticketingEnabled || !evt.ticketPrice) throw error(400, 'Tickets not available');
		// Mirrors getPublicTicketPage. This is the endpoint that actually takes
		// money, so it repeats the check rather than trusting the page guard.
		if (evt.source !== 'cmc') throw error(400, 'Tickets not available');

		const remaining = await getTicketsRemaining(data.eventId);
		if (remaining !== null && data.quantity > remaining) {
			throw error(
				400,
				remaining === 0 ? 'This event is sold out' : `Only ${remaining} tickets remaining`
			);
		}

		const coverFees = data.coverFees;
		const purchaseId = randomUUID();

		await createTickets({
			eventId: evt.id,
			purchaseId,
			quantity: data.quantity,
			userId: locals.user?.id ?? undefined,
			attendeeName: attendee.name,
			attendeeEmail: attendee.email,
			status: 'pending'
		});

		// Member discount keyed off the DB subscription snapshot — the same source
		// every other flow uses (a live Stripe read can disagree after webhook lag
		// or past_due, showing one price and charging another).
		let unitPrice = evt.ticketPrice;
		if (locals.user && (await checkSustainingMember(locals.user.id))) {
			unitPrice = Math.round(unitPrice / 2);
		}

		const lineItem = await buildLineItem('ticket', unitPrice, data.quantity);

		// checkout() spends any credits the buyer has before charging the card, and
		// payment-service reverses every completed deduction if a later one fails.
		// The only way that surfaces here is a lost race — the balance moved between
		// this request pricing the cart and the deduction landing. Nothing is
		// broken and nothing is charged; the buyer just needs to resubmit against
		// the new balance.
		//
		// Reported as a field issue rather than a thrown status because Form routes
		// a thrown error into onfailure(issues), which carries no message — this
		// page's onfailure shows a generic "Something went wrong". It also keeps a
		// routine race out of Sentry, where an unhandled throw lands as a 500.
		let result;
		try {
			result = await checkout({
				stripeCustomerId: locals.user?.stripeId ?? undefined,
				customerEmail: locals.user?.email ?? attendee.email,
				userId: locals.user?.id ?? undefined,
				mode: 'payment',
				lineItems: [lineItem],
				coverFees,
				metadata: {
					type: 'ticket',
					purchase_id: purchaseId,
					event_id: evt.id,
					ticket_quantity: String(data.quantity),
					// The webhook needs this to break the charge into tickets vs. covered
					// fees on the receipt — the session alone can't tell them apart.
					ticket_unit_price_cents: String(unitPrice)
				},
				successUrl: `${url.origin}/events/${evt.id}/tickets/success?purchase_id=${purchaseId}`,
				cancelUrl: `${url.origin}/events/${evt.id}/tickets`
			});
		} catch (err) {
			if (err instanceof InsufficientCreditsError) {
				invalid(
					issue.quantity(
						'Your credit balance changed while this was being processed. Nothing was charged — check the total and try again.'
					)
				);
			}
			throw err;
		}

		if (result.paid) {
			const { fulfillPurchase } = await import('$lib/server/ticket/ticket-service');
			// Credits covered the whole cart — checkout() still records a Stripe
			// payment record for it, so the tickets store that as their proof of
			// payment just like a card purchase does.
			await fulfillPurchase(purchaseId, result.stripePaymentRecordId);
			return { redirectUrl: `/events/${evt.id}/tickets/success?purchase_id=${purchaseId}` };
		}

		return { redirectUrl: result.checkoutUrl! };
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserShows = query(z.string(), async (userId) => {
	await requireStaff();
	const [upcoming, past, pastCount] = await Promise.all([
		listMemberUpcomingShows(userId),
		listMemberPastShows(userId, { limit: 5, offset: 0 }),
		countMemberPastShows(userId)
	]);
	// Projected here rather than in `listMemberShows`: the directory profile
	// reads those same functions and is art-directed, so its rows keep their
	// shape while the staff panel gets refs.
	return { upcoming: upcoming.map(toShowRow), past: past.map(toShowRow), pastCount };
});

/** A show as the staff panel draws it: the event, and the band it credits. */
function toShowRow(show: MemberShowRow) {
	return {
		...show,
		ref: toEventRef({ ...show, image: show.posterKey }),
		band: toBandRef({ id: show.bandId, name: show.bandName, slug: show.bandSlug })
	};
}

export const getUserTicketsAndRsvps = query(z.string(), async (userId) => {
	await requireStaff();
	const [tickets, rsvps] = await Promise.all([getUserTickets(userId), listRsvpsForUser(userId)]);
	// The row's own status is the ticket's or the RSVP's, which is not the
	// event's — so the event ref carries no status here and the page keeps its
	// status column.
	return {
		tickets: tickets.map((t) => ({
			...t,
			ref: toEventRef({ id: t.eventId, title: t.eventTitle, startsAt: t.eventStartsAt })
		})),
		rsvps: rsvps.map((r) => ({
			...r,
			ref: toEventRef({ id: r.eventId, title: r.eventTitle, startsAt: r.startsAt })
		}))
	};
});
