import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { getEventRiderSummaries } from '$lib/server/band/rider-service';
import { requireCapability, requireUser } from '$lib/server/authorization';
import { listRsvpsForUser } from '$lib/server/event/rsvp-service';
import { listDutyLists } from '$lib/server/volunteer/duty-list-service';
import { holdsSpace, listVenues as listLiveVenues } from '$lib/server/venue/venue-service';
import { getProductionByEvent } from '$lib/server/production/production-service';
import { listWorkOrders as listOpenWorkOrders } from '$lib/server/volunteer/work-order-service';
import { bandRefColumns, toBandRef, toEventRef, toMemberRef } from '$lib/server/entity/refs';
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
	listStaffCalendar,
	listEventsNear,
	listUpcoming,
	listPast,
	getEventLineup,
	getEventLineups,
	setEventLineup,
	listMemberUpcomingShows,
	listMemberPastShows,
	type MemberShowRow,
	countMemberPastShows
} from '$lib/server/event/event-service';
import {
	getConflictDetails,
	getValidationWarnings
} from '$lib/server/reservation/conflict-service';
import {
	buildDateInTz,
	buildTimeRangeInTz,
	formatDateInTz
} from '$lib/server/reservation/timezone';
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
	issueFreeTickets,
	getEventTicketMoney,
	type EventTicketMoney,
	countTicketsForEmail,
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
import { buildLineItem } from '$lib/server/finance/product-config-service';
import { validateTicketSplit } from '$lib/finance/ticket-split';
import { FREE_TICKETS_PER_EMAIL, TICKET_COLLECTIVE_SHARE_BPS } from '$lib/config';
import { resolveImageUrl } from '$lib/server/storage';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { venue } from '$lib/server/db/schema/venue';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, like, not, inArray, notInArray, sql } from 'drizzle-orm';
import {
	eventListing,
	createEventSchema,
	eventSources,
	eventKinds,
	lineupSchema
} from '$lib/server/db/schema/event';
import { group } from '$lib/server/db/schema/group';
import { randomUUID } from 'crypto';
import { hasEventEnded } from '$lib/utils/event-time';
import { DEFAULT_TIMEZONE, SEARCH_LIMIT, SHORT_TEXT_MAX } from '$lib/config';
import { formatDateShortYear } from '$lib/utils/format';
import { getShifts, getVolunteerRoles } from './volunteer.remote';
import { getPublicGigGuide } from './calendar.remote';

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
			.select({
				id: eventListing.id,
				title: eventListing.title,
				startsAt: eventListing.startsAt,
				endsAt: eventListing.endsAt
			})
			.from(eventListing)
			.where(inArray(eventListing.id, eventIds));

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
	const [remaining, lineup, isSustainingMember] = await Promise.all([
		evt.ticketingEnabled ? getTicketsRemaining(id) : Promise.resolve(null),
		getEventLineup(id),
		locals.user ? checkSustainingMember(locals.user.id) : Promise.resolve(false)
	]);

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
			ticketPriceFloorCents: evt.ticketPriceFloorCents,
			ticketQuantity: evt.ticketQuantity,
			// An externally ticketed event still takes RSVPs here; the page needs
			// the link to send members to whoever is actually selling.
			source: evt.source,
			externalTicketUrl: evt.externalTicketUrl
		},
		// Display names only — the split bar labels one side with them, and a
		// touring act usually has no `directory_entry` to point at.
		acts: lineup.filter((a) => a.status !== 'declined').map((a) => a.name),
		collectiveShareBps: TICKET_COLLECTIVE_SHARE_BPS,
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
	if (evt.groupId) {
		const [row] = await db
			.select({ name: group.name, slug: group.slug })
			.from(group)
			.where(eq(group.id, evt.groupId))
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
			ticketPriceFloorCents: evt.ticketPriceFloorCents,
			ticketQuantity: evt.ticketQuantity,
			source: evt.source,
			status: evt.status,
			externalTicketUrl: evt.externalTicketUrl,
			bandName: bandInfo?.name ?? null,
			bandSlug: bandInfo?.slug ?? null,
			// The whole bill, every status, and only `confirmed` credits point
			// anywhere at all — an unconfirmed credit must not push traffic to a
			// party that has not agreed to be listed.
			//
			// Where a confirmed one points depends on whether the party has a CMC
			// page. A member or a CMC band does, and gets `slug`. An **external
			// act** does not: CMC hosts no page for a party with no relationship to
			// CMC, so its name links *out* to whatever presence the act itself gave
			// us, or renders as plain text when it gave none. Public attribution
			// links out, never in.
			lineup: lineup.map((l) => ({
				id: l.id,
				name: l.name,
				slug: l.status === 'confirmed' ? l.bandSlug : null,
				externalUrl: l.status === 'confirmed' && !l.bandSlug ? l.externalUrl : null
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
		canReport: evt.status === 'published',
		collectiveShareBps: TICKET_COLLECTIVE_SHARE_BPS,
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

	const [remaining, lineup] = await Promise.all([getTicketsRemaining(id), getEventLineup(id)]);

	const posterUrl = resolveImageUrl(evt.posterKey);

	return {
		event: {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			startsAt: evt.startsAt,
			endsAt: evt.endsAt,
			doorsAt: evt.doorsAt ?? null,
			// The SUGGESTED price and the bottom of the scale. Both, always: the
			// page cannot say what a buyer may pay without the pair.
			ticketPrice: evt.ticketPrice,
			ticketPriceFloorCents: evt.ticketPriceFloorCents,
			ticketQuantity: evt.ticketQuantity
		},
		// Display names only, deliberately — a touring act usually has no
		// `directory_entry` to point at, and the split bar still has to name it.
		acts: lineup.filter((a) => a.status !== 'declined').map((a) => a.name),
		collectiveShareBps: TICKET_COLLECTIVE_SHARE_BPS,
		remaining,
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
	await requireCapability('event.read');
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

// Not exported: a `.remote.ts` file may only export remote functions — Kit rejects the module at
// load time otherwise, and the failure surfaces as every spec that imports it failing to collect.
const staffEventsFilters = z.object({
	source: z.enum(eventSources).optional(),
	status: z.enum(eventStatuses).optional(),
	venueId: z.string().optional(),
	// Day strings, not timestamps: the picker hands over 'YYYY-MM-DD' and the
	// bounds are anchored to the app timezone below.
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
	page: z.number().optional()
});

/**
 * The staff index of CMC work — the Productions page.
 *
 * Three SQL statements, one remote round trip. The venue and the production
 * ride along on `listAll`'s own joins, both 1:1; the lineup summary comes from
 * `getEventLineups`, the batched helper that exists precisely so a list page
 * does not fire one query per row. The venue options come back with the rows so
 * the filter has something to render without a second query — the same trick
 * `getStaffEventPage` uses for its picker.
 */
export const getStaffEvents = query(staffEventsFilters, async (filters) => {
	await requireCapability('event.read');
	const { rows, pagination } = await listAllEvents(
		{
			source: filters.source,
			status: filters.status,
			venueId: filters.venueId,
			from: filters.dateFrom
				? buildDateInTz(filters.dateFrom, '00:00', DEFAULT_TIMEZONE)
				: undefined,
			to: filters.dateTo ? buildDateInTz(filters.dateTo, '23:59', DEFAULT_TIMEZONE) : undefined
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);

	const [lineups, venues] = await Promise.all([
		getEventLineups(rows.map((e) => e.id)),
		listLiveVenues()
	]);

	return {
		rows: rows.map((e) => {
			const bill = lineups.get(e.id) ?? [];
			return {
				...e,
				// The listing's own status is the row's and keeps its column, so the
				// ref carries none — two marks for one fact reads as two facts.
				ref: toEventRef({ id: e.id, title: e.title, startsAt: e.startsAt }),
				// `event.groupId` is who manages the listing; the left join is already
				// here for the byline.
				band: toBandRef({ id: e.groupId, name: e.bandName, slug: e.bandSlug }),
				// Headliner plus a count, not the whole bill: the column is one line
				// wide and the console is one click away.
				lineup: { headliner: bill[0]?.name ?? null, count: bill.length }
			};
		}),
		venues: venues.map((v) => ({ id: v.id, name: v.name })),
		pagination
	};
});

/**
 * The statuses the staff calendar will read, and the only ones it will.
 *
 * `draft` is absent on purpose. A CMC draft is production work and belongs on
 * `/staff/events`; a community draft is a member's private working copy that no
 * staffer should read. `listStaffCalendar` excludes the latter again at the
 * service level — this enum is the first of two guards, not the only one.
 */
const calendarStatuses = ['pending_review', 'published', 'cancelled', 'rejected'] as const;

/**
 * Staff: the public gig guide, plus what is asking to join it.
 *
 * The moderation surface. It is scoped by *status* and reads every source,
 * which is the whole difference from `getStaffEvents` — that one is scoped by
 * source and runs the shows CMC produces. A CMC show appears in both, in two
 * roles: something you are building, and something the public can see.
 */
export const getStaffCalendar = query(
	z.object({
		statuses: z.array(z.enum(calendarStatuses)).min(1).optional(),
		sources: z.array(z.enum(eventSources)).optional(),
		page: z.number().optional()
	}),
	async (filters) => {
		await requireCapability('event.read');
		// Midnight tonight in venue time, not UTC — the same anchor the public gig
		// guide uses, so the two agree about which day a late show belongs to.
		const from = buildDateInTz(
			formatDateInTz(new Date(), DEFAULT_TIMEZONE),
			'00:00',
			DEFAULT_TIMEZONE
		);
		const { rows, pagination } = await listStaffCalendar(
			from,
			{
				// The default view is the queue: a staffer arrives here from a
				// notification, and landing on the whole calendar would bury it.
				statuses: [...(filters.statuses ?? ['pending_review'])],
				sources: filters.sources
			},
			{ page: filters.page ?? 1, pageSize: 50 }
		);
		return {
			rows: rows.map((e) => ({
				...e,
				ref: toEventRef({ id: e.id, title: e.title, startsAt: e.startsAt }),
				band: toBandRef({ id: e.groupId, name: e.bandName, slug: e.bandSlug }),
				// Who is accountable for the row. A band gig answers with its band,
				// a community listing with its member, a CMC show with neither —
				// the page renders "CMC" for that case rather than a ref to us.
				submitter: toMemberRef(e.submitter)
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
	await requireCapability('event.read');
	if (!q || q.length < 2) return [];

	const pattern = `%${q}%`;
	const rows = await db
		.select({ id: eventListing.id, title: eventListing.title, startsAt: eventListing.startsAt })
		.from(eventListing)
		.where(
			and(
				like(eventListing.title, pattern),
				notInArray(eventListing.status, ['cancelled', 'rejected']),
				not(and(eq(eventListing.source, 'community'), eq(eventListing.status, 'draft'))!)
			)
		)
		.orderBy(sql`abs(${eventListing.startsAt} - unixepoch())`)
		.limit(SEARCH_LIMIT);

	// The date arrives as a string because SearchSelect renders its description
	// field verbatim — and it is formatted here so it lands in club time rather
	// than whatever timezone the staffer's laptop is set to.
	return rows.map((e) => ({ id: e.id, title: e.title, when: formatDateShortYear(e.startsAt) }));
});

export const getStaffEventDetail = query(z.string(), async (id) => {
	await requireCapability('event.read');

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
	if (evt.groupId) {
		const [row] = await db
			.select(bandRefColumns())
			.from(group)
			.where(eq(group.id, evt.groupId))
			.limit(1);
		if (row) bookingBand = { id: row.id, name: row.name, slug: row.slug };
	}

	// The one thing the venue row is for: does a show here hold the room? A blank
	// venue means the room, which is what every event created before the column
	// meant and still means.
	let venueName: string | null = null;
	let venueIsPrimary = true;
	if (evt.venueId) {
		const [row] = await db
			.select({ name: venue.name, isPrimary: venue.isPrimary })
			.from(venue)
			.where(eq(venue.id, evt.venueId))
			.limit(1);
		if (row) {
			venueName = row.name;
			venueIsPrimary = row.isPrimary;
		}
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
	let ticketMoney: EventTicketMoney | null = null;
	let tickets: {
		id: string;
		purchaseId: string | null;
		attendeeName: string;
		attendeeEmail: string;
		code: string;
		status: string;
		unitPriceCents: number | null;
		contributionCents: number;
		actsCents: number;
		collectiveCents: number;
		discountWaived: boolean;
		checkedInAt: Date | null;
		createdAt: Date;
	}[] = [];

	if (evt.ticketingEnabled) {
		const [sold, remaining, allTickets, money] = await Promise.all([
			getTicketsSold(evt.id),
			getTicketsRemaining(evt.id),
			getEventTickets(evt.id),
			// Summed in SQL over live tickets only. The page used to add up the
			// ledger it renders, which has no status filter — so a cancelled
			// purchase's contribution still counted as the show's.
			getEventTicketMoney(evt.id)
		]);
		ticketStats = { sold, remaining };
		ticketMoney = money;
		tickets = allTickets.map((t) => ({
			id: t.id,
			purchaseId: t.purchaseId,
			attendeeName: t.attendeeName,
			attendeeEmail: t.attendeeEmail,
			code: t.code,
			status: t.status,
			unitPriceCents: t.unitPriceCents,
			contributionCents: t.contributionCents,
			actsCents: t.actsCents,
			collectiveCents: t.collectiveCents,
			discountWaived: t.discountWaived,
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
			ticketPriceFloorCents: evt.ticketPriceFloorCents,
			ticketQuantity: evt.ticketQuantity,
			posterKey: evt.posterKey,
			source: evt.source,
			kind: evt.kind,
			bandId: evt.groupId,
			location: evt.location,
			venueId: evt.venueId,
			venueName,
			/** True with no venue set at all: that is what an event has always meant. */
			venueIsPrimary,
			externalTicketUrl: evt.externalTicketUrl,
			// What staff already told the member, so a second reviewer does not
			// repeat a note the first one wrote.
			reviewNotes: evt.reviewNotes
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
		// The bill. The *public* event page has shown this all along, so until
		// now a visitor to a published listing could see who was playing and the
		// staffer deciding whether to publish it could not.
		lineup: await getEventLineup(id),
		linkedReservation,
		ticketStats,
		ticketMoney,
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
		await requireCapability('event.read');
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
		await requireCapability('event.read');
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
	const staff = await requireCapability('event.manage');

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
	// A show somewhere else cannot hold the practice room. Refused rather than
	// silently ignored: staff who ticked the box asked for something, and the
	// useful answer is why it is not going to happen — not an event that quietly
	// came out different from the form.
	if (reserveSpace && !(await holdsSpace(data.venueId || null))) {
		invalid(
			issue.reserveSpace('That venue is not the practice room, so there is no space here to hold.')
		);
	}

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
		kind: data.kind,
		ticketingEnabled,
		ticketPrice: ticketingEnabled ? ticketPrice : undefined,
		ticketQuantity: ticketingEnabled ? ticketQuantity : undefined,
		venueId: data.venueId || null,
		location: data.location || null,
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
/**
 * Everything the staff event detail page needs, in one round trip.
 *
 * The page used to read four queries and await them together with
 * `Promise.all` in the component. That is one HTTP request per query — four
 * round trips the browser pays on every visit — and past kit 2.64 it also
 * drives the page into `effect_update_depth_exceeded`: any shape that puts the
 * four in flight at once loops (bisected to kit#15991, "dedupe remote data").
 *
 * Fanning out here instead costs one request. The four still run in parallel,
 * but on the server where they are a local D1 hop rather than a network one,
 * and the client holds a single query instance with nothing to race.
 *
 * Each callee re-guards; the capability check here is the boundary for this
 * function itself, not a substitute for theirs.
 */
/** The lineup editor posts JSON in a hidden field; a malformed one is ignored. */
function parseStaffLineupField(raw: string | undefined) {
	if (raw === undefined || raw === '') return undefined;
	try {
		const parsed = lineupSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The general event view at `/staff/events/[id]` — every source, any staffer.
 *
 * This is where `entity-href` sends every event ref, so it is the default
 * landing point for an event from anywhere in the panel: a volunteer shift, a
 * reservation, a member's record, a notification. It carries facts and the
 * moderation actions and nothing that only a producer needs; the console at
 * `[id]/production` is the specialisation, and has its own query below.
 */
export const getStaffEventPage = query(z.string(), async (id) => {
	await requireCapability('event.read');

	const detail = await getStaffEventDetail(id);
	const [nearby, venues, production] = await Promise.all([
		listEventsNear(detail.event.startsAt, { excludeEventId: id }),
		venuePickerOptions(),
		// Only so the header knows whether to offer "Add production". The record
		// itself is worked on in the console.
		getProductionByEvent(id)
	]);

	return {
		detail,
		venues,
		production,
		nearby: nearby.map((e) => ({
			id: e.id,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			status: e.status,
			source: e.source,
			ref: toEventRef({ id: e.id, title: e.title, startsAt: e.startsAt }),
			band: toBandRef({ id: e.groupId, name: e.bandName, slug: e.bandSlug })
		}))
	};
});

/**
 * The production console's data, which only a CMC show has any use for.
 *
 * Separate from `getStaffEventPage` rather than branched inside it: the console
 * is its own route now, so a listing simply never asks for volunteer roles it
 * will never render. Branching client-side would have needed `source` first,
 * which is the await-chain the comment on the old page warned about.
 */
/**
 * Staff set the bill on any event, and `asStaff` is not a formality.
 *
 * `setEventLineup` resolves a newly linked act to `confirmed` when `asStaff` is
 * set — "Staff booked the show, so every act they name is already agreed." That
 * holds for a CMC production. It is false for a listing: staff did not book a
 * member's show, and confirming on their behalf would put a credit on the named
 * band's public profile that the band never agreed to. Consent is the whole
 * point of the pending state — see `docs/specs/shipped/event-lineup-spec.md`.
 *
 * So the flag follows the source, and on a listing a new link lands `pending`
 * and invites the band, exactly as when a member links it. Do not simplify this
 * to a constant.
 *
 * Both paths are already safe against reviving a refused credit: the prior-row
 * branch in `setEventLineup` runs first, so `declined` stays `declined`.
 */
export const setStaffEventLineup = form(
	z.object({ eventId: z.string().min(1), lineup: z.string().optional() }),
	async (data) => {
		await requireCapability('event.manage');
		const evt = await getById(data.eventId);
		if (!evt) error(404, 'Event not found');

		const lineup = parseStaffLineupField(data.lineup);
		if (lineup) {
			await setEventLineup(data.eventId, lineup, { asStaff: evt.source === 'cmc' });
		}

		void getStaffEventPage(data.eventId).refresh();
		return { success: true };
	}
);

/** Live venues, shaped for the venue picker on the two staff edit forms. */
async function venuePickerOptions() {
	const rows = await listLiveVenues();
	return rows.map((v) => ({ id: v.id, name: v.name, isPrimary: v.isPrimary }));
}

/** Active duty lists that actually have items on them — the apply picker. */
async function listApplicableDutyLists() {
	const lists = await listDutyLists();
	return lists.filter((l) => l.itemCount > 0).map((l) => ({ id: l.id, name: l.name }));
}

export const getStaffEventProduction = query(z.string(), async (id) => {
	await requireCapability('event.read');

	// Duty lists ride along in the page's one load-bearing query rather than
	// being fetched beside it: awaited remote queries are serial round trips, and
	// `custom/no-concurrent-remote-queries` exists to stop a page fanning them out.
	const [
		detail,
		recurringSeries,
		shifts,
		advance,
		volunteerRoles,
		dutyLists,
		venues,
		riders,
		production
	] = await Promise.all([
		getStaffEventDetail(id),
		getEventRecurringSeries(id),
		getShifts({ eventId: id }),
		// `listShifts` filters `starts_at IS NOT NULL`, so the advance half of an
		// applied duty list — a `dueOffsetMinutes` item, which is where the
		// booking work lives — never reached this page. The card said a show was
		// unstaffed while carrying six open tasks.
		listOpenWorkOrders({ eventId: id }),
		getVolunteerRoles(),
		listApplicableDutyLists(),
		venuePickerOptions(),
		// What each act on the bill says it needs. The advance checklist has always
		// carried a task reading "Collect tech riders and stage plots"; this is the
		// answer to it, on the page where that work happens.
		getEventRiderSummaries(id),
		// The ops record: load-in through load-out, the producer, the notes.
		// Null until someone opens one from the event page.
		getProductionByEvent(id)
	]);

	return {
		detail,
		recurringSeries,
		shifts,
		advance,
		volunteerRoles,
		dutyLists,
		venues,
		riders,
		production
	};
});

export const getEventRecurringSeries = query(z.string(), async (eventId) => {
	await requireCapability('event.read');
	const series = await getByEvent(eventId);
	if (!series) return null;
	return getEventSeries(series.id);
});

/** Stop a recurring event series; existing occurrences remain (staff). */
export const cancelEventSeries = form(z.object({ seriesId: z.string() }), async (data) => {
	await requireCapability('event.manage');
	await cancelSeries(data.seriesId);
	return { success: true };
});

export const updateEvent = form(
	z.object({
		eventId: z.string().min(1),
		title: z.string().optional(),
		description: z.string().optional(),
		tags: z.string().optional(),
		kind: z.enum(eventKinds).optional(),
		eventDate: z.string().optional(),
		eventStartTime: z.string().optional(),
		eventEndTime: z.string().optional(),
		doorsTime: z.string().optional(),
		// Band gigs live off these two — without them staff can see a wrong venue
		// or a dead ticket link on the guide and have no way to fix it.
		location: z.string().max(SHORT_TEXT_MAX).optional(),
		venueId: z.string().optional(),
		externalTicketUrl: z.string().max(500).optional(),
		ticketingEnabled: z.boolean().optional(),
		ticketPrice: z.string().optional(),
		ticketPriceFloorCents: z.string().optional(),
		ticketQuantity: z.string().optional(),
		rebookReservation: z.boolean().default(false),
		reservationStartTime: z.string().optional(),
		reservationEndTime: z.string().optional(),
		overrideConflicts: z.boolean().default(false)
	}),
	async (data) => {
		const staff = await requireCapability('event.manage');
		const tz = DEFAULT_TIMEZONE;

		const ticketingEnabled = data.ticketingEnabled;
		const rebookReservation = data.rebookReservation;
		const overrideConflicts = data.overrideConflicts;

		const updateParams: Parameters<typeof update>[1] = {};

		if (data.title !== undefined && data.title !== '') updateParams.title = data.title;
		if (data.description !== undefined) updateParams.description = data.description || null;
		if (data.tags !== undefined) updateParams.tags = data.tags || null;
		if (data.kind !== undefined) updateParams.kind = data.kind;
		if (data.location !== undefined) updateParams.location = data.location || null;
		// An empty string detaches, an absent field leaves it alone — the same
		// distinction `updateShift` draws for its own event link, and for the same
		// reason: a form that omits the field must not silently clear it.
		if (data.venueId !== undefined) updateParams.venueId = data.venueId || null;
		if (data.externalTicketUrl !== undefined) {
			updateParams.externalTicketUrl = data.externalTicketUrl || null;
		}
		if (ticketingEnabled !== undefined) updateParams.ticketingEnabled = ticketingEnabled;
		if (data.ticketPrice !== undefined) {
			updateParams.ticketPrice = data.ticketPrice ? parseInt(data.ticketPrice, 10) : null;
		}
		// A cleared floor is a floor of zero, not an absent one — the column is
		// NOT NULL, and "no minimum" is the meaningful reading of an empty field.
		if (data.ticketPriceFloorCents !== undefined) {
			updateParams.ticketPriceFloorCents = data.ticketPriceFloorCents
				? parseInt(data.ticketPriceFloorCents, 10)
				: 0;
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
	await requireCapability('event.publish');
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
		await requireCapability('event.publish');
		// Band-sourced events notify the band's admins — pulling a gig silently is
		// the one unpublish that needs a word back to whoever posted it.
		await unpublishWithNotice(data.id, { notes: data.notes });
		return { success: true };
	}
);

export const cancelEvent = form(z.object({ id: z.string().min(1) }), async (data) => {
	const staff = await requireCapability('event.manage');
	await cancel(data.id, staff.id);
	return { success: true };
});

/**
 * What a delete would destroy. Drives the confirmation copy, so a staffer can
 * tell a mistake from a real event before it is gone.
 */
export const getEventDeletionImpact = query(z.string(), async (id) => {
	await requireCapability('event.read');
	return getDeletionImpact(id);
});

export const deleteEvent = form(z.object({ id: z.string().min(1) }), async (data) => {
	const staff = await requireCapability('event.manage');
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
		await requireCapability('event.manageTickets');

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
		await requireCapability('event.manageTickets');
		await cancelTicketService(data.ticketId);
		return { success: true };
	}
);

export const checkInTicket = form(z.object({ ticketId: z.string().min(1) }), async (data) => {
	const staff = await requireCapability('event.manageTickets');
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

		await issueFreeTickets({
			eventId: evt.id,
			purchaseId,
			quantity: data.quantity,
			userId: locals.user?.id ?? undefined,
			attendeeName: attendee.name,
			attendeeEmail: attendee.email
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
		coverFees: z.boolean().default(false),
		// Whole cents, posted from the scale and the split bar. Numbers rather than
		// the dollars string the contribution field used to be: these come from
		// hidden fields the component computes, so there is no partially-typed
		// state to preserve, and `.as('number', …)` keeps the `fields` inference
		// the <Form> component relies on.
		unitPriceCents: z.number().int().min(0).optional().default(0),
		collectiveCents: z.number().int().min(0).optional().default(0)
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

		// Nothing the client posted is trusted, including the arithmetic — these
		// numbers become what the acts are owed. The event's own suggested price
		// and floor are the only two figures here the buyer does not control, and
		// everything else is checked against them.
		const validated = validateTicketSplit({
			unitPriceCents: data.unitPriceCents,
			quantity: data.quantity,
			collectiveCents: data.collectiveCents,
			coverFees: data.coverFees,
			suggestedUnitCents: evt.ticketPrice,
			floorCents: evt.ticketPriceFloorCents
		});
		// Under the amount field rather than as a toast: the buyer's next move is
		// to change that number, and a toast does not say which number.
		if (!validated.ok) invalid(issue.unitPriceCents(validated.reason));
		const split = validated.split;

		const remaining = await getTicketsRemaining(data.eventId);
		if (remaining !== null && data.quantity > remaining) {
			throw error(
				400,
				remaining === 0 ? 'This event is sold out' : `Only ${remaining} tickets remaining`
			);
		}

		// The scale reached zero. Nothing to charge, so Stripe is never involved:
		// the rows are valid on creation, exactly like a free event's claim.
		if (split.chargeCents === 0) {
			const held = await countTicketsForEmail(evt.id, attendee.email);
			if (held + data.quantity > FREE_TICKETS_PER_EMAIL) {
				invalid(
					issue.quantity(
						`That would be more than ${FREE_TICKETS_PER_EMAIL} free tickets on one email for this show. Get in touch if you need a bigger group.`
					)
				);
			}

			const freeId = `free-${randomUUID()}`;
			await issueFreeTickets({
				eventId: evt.id,
				purchaseId: freeId,
				quantity: data.quantity,
				userId: locals.user?.id ?? undefined,
				attendeeName: attendee.name,
				attendeeEmail: attendee.email
			});
			return { redirectUrl: `/events/${evt.id}/tickets/success?purchase_id=${freeId}` };
		}

		const purchaseId = randomUUID();

		await createTickets({
			eventId: evt.id,
			purchaseId,
			quantity: data.quantity,
			userId: locals.user?.id ?? undefined,
			attendeeName: attendee.name,
			attendeeEmail: attendee.email,
			status: 'pending',
			unitPriceCents: split.ticketLineUnitCents,
			contributionCents: split.contributionCents,
			actsCents: split.actsCents,
			collectiveCents: split.collectiveCents,
			feeCoveredCents: split.feeCoveredCents
		});

		const lineItems = [await buildLineItem('ticket', split.ticketLineUnitCents, data.quantity)];
		// Paying above the suggested price is a gift, and it rides as its own line
		// item under its own product — so it never reads as ticket revenue in
		// Stripe, and the receipt can name it.
		if (split.contributionCents > 0) {
			lineItems.push(await buildLineItem('ticket_contribution', split.contributionCents, 1));
		}

		const result = await checkout({
			stripeCustomerId: locals.user?.stripeId ?? undefined,
			customerEmail: locals.user?.email ?? attendee.email,
			userId: locals.user?.id ?? undefined,
			mode: 'payment',
			lineItems,
			coverFees: data.coverFees,
			metadata: {
				type: 'ticket',
				purchase_id: purchaseId,
				event_id: evt.id,
				ticket_quantity: String(data.quantity),
				// The webhook needs these to break the charge into tickets, gift, and
				// covered fees on the receipt — the session alone can't tell them apart.
				ticket_unit_price_cents: String(split.ticketLineUnitCents),
				ticket_contribution_cents: String(split.contributionCents),
				// Not read by the webhook, which takes the allocation off the ticket
				// rows. These are for settlement, which reconciles against Stripe by
				// event_id and should be able to see where the buyer sent the money.
				ticket_acts_cents: String(split.actsCents),
				ticket_collective_cents: String(split.collectiveCents)
			},
			successUrl: `${url.origin}/events/${evt.id}/tickets/success?purchase_id=${purchaseId}`,
			cancelUrl: `${url.origin}/events/${evt.id}/tickets`
		});

		// Tickets never spend credits — no CreditType applies to them — so this
		// call always comes back with a URL. Asserting that is honest; the branch
		// that used to be here handled a `paid: true` that checkout() cannot
		// return without `eligibleCredits`, which this never passed.
		if (!result.checkoutUrl) throw error(500, 'Checkout could not be started');
		return { redirectUrl: result.checkoutUrl };
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserShows = query(z.string(), async (userId) => {
	await requireCapability('event.read');
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
	await requireCapability('event.read');
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

/**
 * The member event detail page's one load-bearing query.
 *
 * The ticket list is what decides whether the page shows "RSVP" or "you're going", so it is first
 * paint alongside the event itself. Both refresh sites on the page repoint here.
 */
export const getMemberEventDetailPage = query(z.string(), async (id) => {
	const [event, tickets] = await Promise.all([getMemberEventDetail(id), getMemberTickets()]);
	// The ticket form prefills the buyer's own name and email. The page used to
	// read these off `page.data`, but nothing in this app populates `page.data` —
	// there are no layout loads, only remote functions — so the fields silently
	// always started empty. An `as any` cast on `page.data` was hiding it.
	const viewer = requireUser();
	return { event, tickets, viewer: { name: viewer.name, email: viewer.email } };
});

/** The public events page's one load-bearing query. Neither half has a refresh site. */
export const getPublicEventsPage = query(z.string().optional(), async (from) => {
	const [events, guide] = await Promise.all([
		getPublicEvents(),
		getPublicGigGuide({ from, offset: 0 })
	]);
	return { events, guide };
});

/**
 * The member events page's one load-bearing query.
 *
 * Only the two queries that live in this file. `getMyListings` is deliberately left out: it lives
 * in `community-events.remote.ts` along with the six mutations that refresh it, and composing it
 * here would mean that file importing this one — a cycle, and one that dragged the whole
 * `volunteer.remote` graph into `community-events.remote.spec.ts` and broke its mocks. The
 * listings section owns that query itself instead.
 */
export const getMemberEventsPage = query(z.void(), async () => {
	const [events, tickets] = await Promise.all([getMemberEvents(), getMemberTickets()]);
	return { events, tickets };
});
