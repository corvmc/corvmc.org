import { z } from 'zod';
import { invalid } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { getStanding } from '$lib/server/moderation/standing-service';
import {
	listCommunityEventsForUser,
	listRejectedForUser,
	countPublishedListingsBy,
	listPendingSubmissions,
	countPendingSubmissions,
	checkForDuplicate,
	createCommunityEvent,
	updateCommunityEvent,
	publishCommunityEvent,
	unpublishCommunityEvent,
	withdrawCommunityEvent,
	deleteCommunityEventDraft,
	approveSubmission,
	rejectSubmission
} from '$lib/server/event/community-event-service';
import { getById, getEventLineup } from '$lib/server/event/event-service';
import { toEventRef } from '$lib/server/entity/refs';
import { searchBandsByName } from '$lib/server/band/band-service';
import { communityEventSchema, lineupSchema } from '$lib/server/db/schema/event';
import { buildDateInTz, buildTimeRangeInTz } from '$lib/server/reservation/timezone';
import { dollarsToCents } from '$lib/utils/event-ticketing';
import { resolveImageUrl, validateUpload } from '$lib/server/storage';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { getStaffLayout } from './layout.remote';

// ---------------------------------------------------------------------------
// Community listings — member-authored events on the public gig guide
// ---------------------------------------------------------------------------
// Every function guards itself before touching the DB. The member-facing ones
// take `requireUser()` and then hand the caller's id to the service, which
// enforces ownership in its own queries — the guard here establishes *who is
// asking*, the service decides whether that person may touch this row.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The caller's own listings, drafts included. Never anybody else's. */
export const getMyListings = query(async () => {
	const user = requireUser();
	const [listings, rejected, standing] = await Promise.all([
		listCommunityEventsForUser(user.id),
		listRejectedForUser(user.id),
		getStanding(user.id, 'community_event')
	]);

	const shape = (e: Awaited<ReturnType<typeof listCommunityEventsForUser>>[number]) => ({
		id: e.id,
		title: e.title,
		status: e.status,
		startsAt: e.startsAt,
		endsAt: e.endsAt,
		location: e.location,
		posterUrl: resolveImageUrl(e.posterKey)
	});

	return {
		listings: listings.map(shape),
		rejected: rejected.map(shape),
		standing
	};
});

/** One of the caller's listings, for the manage page. */
export const getMyListing = query(z.string(), async (eventId) => {
	const user = requireUser();
	const evt = await getById(eventId);
	// Same answer for "no such listing" and "not yours" — see NotListingOwnerError.
	if (!evt || evt.source !== 'community' || evt.createdByUserId !== user.id) {
		return null;
	}

	const [lineup, standing] = await Promise.all([
		getEventLineup(eventId),
		getStanding(user.id, 'community_event')
	]);

	return {
		id: evt.id,
		title: evt.title,
		description: evt.description,
		status: evt.status,
		startsAt: evt.startsAt,
		endsAt: evt.endsAt,
		doorsAt: evt.doorsAt,
		location: evt.location,
		tags: evt.tags,
		externalTicketUrl: evt.externalTicketUrl,
		ticketPrice: evt.ticketPrice,
		posterUrl: resolveImageUrl(evt.posterKey),
		reviewNotes: evt.reviewNotes,
		lineup,
		standing
	};
});

/** The staff review queue. Keyed on pending_review, so drafts never appear. */
export const getPendingSubmissions = query(
	z.object({ page: z.coerce.number().int().min(1).optional() }).optional(),
	async (filters) => {
		await requireStaff();
		return listPendingSubmissions({ page: filters?.page ?? 1, pageSize: 50 });
	}
);

export const getPendingSubmissionCount = query(async () => {
	await requireStaff();
	return countPendingSubmissions();
});

/**
 * Band lookup for the listing form's lineup editor.
 *
 * `requireUser` rather than the band panel's `requireBandMemberOrStaff`: the
 * person writing a community listing may not be in a band at all, and band
 * names are already public on the directory. Returns nothing a signed-out
 * visitor couldn't read from /directory/bands.
 */
export const searchBandsForListing = query(z.string(), async (q) => {
	requireUser();
	if (!q || q.trim().length < 2) return [];
	return searchBandsByName(q.trim());
});

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function readPosterFile(file: File | undefined) {
	if (!file || file.size === 0) return undefined;
	return file;
}

async function toPosterParam(file: File | undefined) {
	if (!file) return undefined;
	return { buffer: await file.arrayBuffer(), contentType: file.type };
}

function parseLineupField(raw: string | undefined) {
	if (raw === undefined || raw === '') return undefined;
	try {
		const parsed = lineupSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Build the show's time range. The end time is optional for the same reason it
 * is on band gigs — whoever is posting this usually can't say when the night
 * finishes. `buildTimeRangeInTz` only matters when an end *was* given, since its
 * job is rolling a past-midnight end onto the next day.
 */
function buildRange(date: string, startTime: string, endTime: string | undefined, tz: string) {
	if (!endTime) return { startsAt: buildDateInTz(date, startTime, tz), endsAt: null };
	return buildTimeRangeInTz(date, startTime, endTime, tz);
}

// ---------------------------------------------------------------------------
// Member forms
// ---------------------------------------------------------------------------

export const createListing = form(
	communityEventSchema.extend({ posterFile: z.instanceof(File).optional() }),
	async (data, issue) => {
		const user = requireUser();

		const ticketPrice = dollarsToCents(data.ticketPriceDollars);
		if (ticketPrice === undefined) {
			invalid(issue.ticketPriceDollars('Enter a price like 10.00, or leave blank'));
		}

		const poster = readPosterFile(data.posterFile);
		if (poster) {
			const reason = validateUpload(poster);
			if (reason) invalid(issue.posterFile(reason));
		}

		const tz = DEFAULT_TIMEZONE;
		const { startsAt, endsAt } = buildRange(
			data.eventDate,
			data.eventStartTime,
			data.eventEndTime || undefined,
			tz
		);
		const doorsAt = data.doorsTime ? buildDateInTz(data.eventDate, data.doorsTime, tz) : null;

		try {
			const evt = await createCommunityEvent({
				createdByUserId: user.id,
				title: data.title,
				description: data.description || undefined,
				startsAt,
				endsAt,
				doorsAt,
				location: data.location || undefined,
				tags: data.tags || undefined,
				externalTicketUrl: data.externalTicketUrl || undefined,
				ticketPrice,
				lineup: parseLineupField(data.lineup),
				posterFile: await toPosterParam(poster)
			});

			void getMyListings().refresh();
			return { eventId: evt.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const updateListing = form(
	communityEventSchema.extend({
		eventId: z.string().min(1),
		posterFile: z.instanceof(File).optional()
	}),
	async (data, issue) => {
		const user = requireUser();

		const ticketPrice = dollarsToCents(data.ticketPriceDollars);
		if (ticketPrice === undefined) {
			invalid(issue.ticketPriceDollars('Enter a price like 10.00, or leave blank'));
		}

		const poster = readPosterFile(data.posterFile);
		if (poster) {
			const reason = validateUpload(poster);
			if (reason) invalid(issue.posterFile(reason));
		}

		const tz = DEFAULT_TIMEZONE;
		const { startsAt, endsAt } = buildRange(
			data.eventDate,
			data.eventStartTime,
			data.eventEndTime || undefined,
			tz
		);

		try {
			await updateCommunityEvent(data.eventId, user.id, {
				title: data.title,
				description: data.description || null,
				startsAt,
				endsAt,
				// An emptied time field clears the value; that is how a member drops
				// a wrong doors time rather than only how they omit one.
				doorsAt: data.doorsTime ? buildDateInTz(data.eventDate, data.doorsTime, tz) : null,
				location: data.location || null,
				tags: data.tags || null,
				externalTicketUrl: data.externalTicketUrl || null,
				ticketPrice,
				lineup: parseLineupField(data.lineup),
				posterFile: await toPosterParam(poster)
			});
		} catch (err) {
			mapDomainError(err);
		}

		void getMyListing(data.eventId).refresh();
		void getMyListings().refresh();
		void getStaffLayout().refresh();
		return { success: true };
	}
);

export const publishListing = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	try {
		const result = await publishCommunityEvent(data.eventId, user.id);
		void getMyListing(data.eventId).refresh();
		void getMyListings().refresh();
		// The review queue badge moves whenever a listing enters it, or the
		// sidebar keeps the old number.
		void getStaffLayout().refresh();
		return result;
	} catch (err) {
		mapDomainError(err);
	}
});

export const unpublishListing = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	try {
		await unpublishCommunityEvent(data.eventId, user.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getMyListing(data.eventId).refresh();
	void getMyListings().refresh();
	return { success: true };
});

export const withdrawListing = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	try {
		await withdrawCommunityEvent(data.eventId, user.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getMyListing(data.eventId).refresh();
	void getMyListings().refresh();
	return { success: true };
});

export const deleteListing = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	try {
		await deleteCommunityEventDraft(data.eventId, user.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getMyListings().refresh();
	return { success: true };
});

/**
 * Advisory duplicate check, run from the manage page before publishing.
 *
 * A query rather than part of the publish form on purpose: it warns, and the
 * member decides. Blocking would punish the honest case this exists to catch.
 */
export const findDuplicateListing = query(z.string(), async (eventId) => {
	const user = requireUser();
	const evt = await getById(eventId);
	if (!evt || evt.source !== 'community' || evt.createdByUserId !== user.id) return null;
	return checkForDuplicate({
		title: evt.title,
		startsAt: evt.startsAt,
		excludeEventId: evt.id
	});
});

// ---------------------------------------------------------------------------
// Staff forms
// ---------------------------------------------------------------------------

export const approveListing = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const staff = await requireStaff();
	try {
		await approveSubmission(data.eventId, staff.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getPendingSubmissions().refresh();
	void getStaffLayout().refresh();
	return { success: true };
});

export const rejectListing = form(
	z.object({
		eventId: z.string().min(1),
		// Required, not optional: a member who can't see what was wrong can't fix
		// it, and `rejected` exists precisely so they can.
		notes: z.string().trim().min(1, 'Give the member a reason').max(1000)
	}),
	async (data) => {
		const staff = await requireStaff();
		try {
			await rejectSubmission(data.eventId, staff.id, data.notes);
		} catch (err) {
			mapDomainError(err);
		}
		void getPendingSubmissions().refresh();
		void getStaffLayout().refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserListings = query(z.string(), async (userId) => {
	await requireStaff();
	const [listings, rejected, publishedCount] = await Promise.all([
		listCommunityEventsForUser(userId),
		listRejectedForUser(userId),
		countPublishedListingsBy(userId)
	]);
	// The listing's own review state is the row's status and stays in its
	// column; the ref is the event the listing is for.
	const withRef = (e: (typeof listings)[number]) => ({
		...e,
		ref: toEventRef({ id: e.id, title: e.title, startsAt: e.startsAt })
	});
	return { listings: listings.map(withRef), rejected: rejected.map(withRef), publishedCount };
});
