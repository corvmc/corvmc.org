import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireBandAdmin, requireBandMemberOrStaff } from '$lib/server/band/band-context';
import {
	createBandEvent,
	updateBandEvent,
	cancelBandEvent,
	listBandEvents,
	importBandEvents,
	clearBandEventPoster,
	setEventLineup,
	getEventLineup,
	getEventLineups,
	confirmLineupSlot,
	declineLineupSlot,
	listBandLineupInvites,
	publish,
	unpublish,
	getById
} from '$lib/server/event/event-service';
import { lineupSchema } from '$lib/server/db/schema/event';
import { searchBandsByName } from '$lib/server/band/band-service';
import { buildDateInTz, buildTimeRangeInTz } from '$lib/server/reservation/timezone';
import { dollarsToCents } from '$lib/utils/event-ticketing';
import { parseGigImport, GIG_IMPORT_DEFAULT_START } from '$lib/utils/gig-import';
import { resolveImageUrl, validateUpload } from '$lib/server/storage';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Everything on this band's bill, any status — the band panel list.
 *
 * Guarded by membership-or-staff rather than `requireUser`: this returns
 * unpublished drafts, and any signed-in user could previously read another
 * band's by passing their slug.
 */
export const getBandEvents = query(z.string(), async () => {
	const { band } = await requireBandMemberOrStaff();
	const events = await listBandEvents(band.id);
	const lineups = await getEventLineups(events.map((e) => e.id));

	return events.map((e) => ({
		id: e.id,
		title: e.title,
		startsAt: e.startsAt,
		endsAt: e.endsAt,
		status: e.status,
		location: e.location,
		posterUrl: resolveImageUrl(e.posterKey),
		/** False for shows this band was credited on but doesn't manage. */
		isOwner: e.isOwner,
		lineup: lineups.get(e.id) ?? []
	}));
});

/** Bills this band has been named on and hasn't answered. */
export const getBandLineupInvites = query(z.string(), async () => {
	const { band } = await requireBandMemberOrStaff();
	return listBandLineupInvites(band.id);
});

/** One gig, for the detail page. */
export const getBandEventDetail = query(
	z.object({ slug: z.string(), eventId: z.string() }),
	async ({ eventId }) => {
		const { band } = await requireBandMemberOrStaff();
		const evt = await getById(eventId);

		if (!evt) throw error(404, 'Event not found');

		// Visible if this band owns it, or is credited on the bill.
		const lineup = await getEventLineup(eventId);
		const credited = lineup.some((l) => l.bandId === band.id);
		if (evt.bandId !== band.id && !credited) throw error(404, 'Event not found');

		return {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			startsAt: evt.startsAt,
			endsAt: evt.endsAt,
			doorsAt: evt.doorsAt,
			status: evt.status,
			location: evt.location,
			tags: evt.tags,
			externalTicketUrl: evt.externalTicketUrl,
			ticketPrice: evt.ticketPrice,
			posterUrl: resolveImageUrl(evt.posterKey),
			isOwner: evt.bandId === band.id,
			lineup
		};
	}
);

/** Band-facing band lookup for the lineup editor. Staff-only `searchBands` can't be reused. */
export const searchBandsForLineup = query(z.string(), async (q) => {
	await requireBandMemberOrStaff();
	if (!q || q.trim().length < 2) return [];
	return searchBandsByName(q.trim());
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** A poster upload, or undefined when the field was left empty. */
function readPosterFile(file: File | undefined) {
	if (!file || file.size === 0) return undefined;
	return file;
}

async function toPosterParam(file: File | undefined) {
	if (!file) return undefined;
	return { buffer: await file.arrayBuffer(), contentType: file.type };
}

/** Hidden JSON field written by LineupEditor. Absent means "leave the bill alone". */
function parseLineupField(raw: string | undefined) {
	if (raw === undefined || raw === '') return undefined;
	const parsed = lineupSchema.safeParse(JSON.parse(raw));
	return parsed.success ? parsed.data : undefined;
}

/**
 * Build the gig's time range.
 *
 * The end time is optional — a band backfilling old shows usually can't say
 * when the night finished, and `event.endsAt` is nullable for exactly that.
 * `buildTimeRangeInTz` only comes into play when an end *was* given, since its
 * job is rolling a past-midnight end onto the next day.
 */
function buildGigRange(date: string, startTime: string, endTime: string | undefined, tz: string) {
	if (!endTime) {
		return { startsAt: buildDateInTz(date, startTime, tz), endsAt: null };
	}
	return buildTimeRangeInTz(date, startTime, endTime, tz);
}

export const createBandEventForm = form(
	z.object({
		title: z.string().min(1, 'Title is required').max(200),
		description: z.string().max(5000).optional(),
		eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
		eventStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
		// Optional: see buildGigRange.
		eventEndTime: z
			.string()
			.regex(/^$|^\d{2}:\d{2}$/, 'Invalid time')
			.optional(),
		doorsTime: z.string().optional(),
		location: z.string().max(500).optional(),
		tags: z.string().max(500).optional(),
		externalTicketUrl: z.string().url().optional().or(z.literal('')),
		ticketPriceDollars: z.string().max(12).optional(),
		lineup: z.string().optional(),
		posterFile: z.instanceof(File).optional()
	}),
	async (data, issue) => {
		const { user, band } = await requireBandAdmin();

		if (!data.title) {
			invalid(issue.title('Title is required'));
		}

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
		const { startsAt, endsAt } = buildGigRange(
			data.eventDate,
			data.eventStartTime,
			data.eventEndTime || undefined,
			tz
		);
		const doorsAt = data.doorsTime ? buildDateInTz(data.eventDate, data.doorsTime, tz) : undefined;

		const lineup = parseLineupField(data.lineup);

		const evt = await createBandEvent({
			bandId: band.id,
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
			// The owner's own slot is written by the service; these are the rest.
			support: lineup?.filter((l) => l.bandId !== band.id),
			posterFile: await toPosterParam(poster)
		});

		return { eventId: evt.id };
	}
);

export const updateBandEventForm = form(
	z.object({
		eventId: z.string().min(1),
		title: z.string().min(1).max(200).optional(),
		description: z.string().max(5000).optional(),
		eventDate: z.string().optional(),
		eventStartTime: z.string().optional(),
		eventEndTime: z.string().optional(),
		doorsTime: z.string().optional(),
		location: z.string().max(500).optional(),
		tags: z.string().max(500).optional(),
		externalTicketUrl: z.string().optional(),
		ticketPriceDollars: z.string().max(12).optional(),
		lineup: z.string().optional(),
		posterFile: z.instanceof(File).optional()
	}),
	async (data, issue) => {
		const { band } = await requireBandAdmin();

		const tz = DEFAULT_TIMEZONE;
		const params: Parameters<typeof updateBandEvent>[2] = {};

		if (data.ticketPriceDollars !== undefined) {
			const ticketPrice = dollarsToCents(data.ticketPriceDollars);
			if (ticketPrice === undefined) {
				invalid(issue.ticketPriceDollars('Enter a price like 10.00, or leave blank'));
			}
			params.ticketPrice = ticketPrice;
		}

		if (data.title !== undefined) params.title = data.title;
		if (data.description !== undefined) params.description = data.description || null;
		if (data.location !== undefined) params.location = data.location || null;
		if (data.tags !== undefined) params.tags = data.tags || null;
		if (data.externalTicketUrl !== undefined) {
			params.externalTicketUrl = data.externalTicketUrl || null;
		}

		// A date plus a start is enough. Submitting an empty end time clears it —
		// that is how a band drops a wrong end, not just how it omits one.
		if (data.eventDate && data.eventStartTime) {
			const range = buildGigRange(
				data.eventDate,
				data.eventStartTime,
				data.eventEndTime || undefined,
				tz
			);
			params.startsAt = range.startsAt;
			params.endsAt = range.endsAt;
		}

		if (data.doorsTime !== undefined && data.eventDate) {
			params.doorsAt = data.doorsTime ? buildDateInTz(data.eventDate, data.doorsTime, tz) : null;
		}

		const poster = readPosterFile(data.posterFile);
		if (poster) {
			const reason = validateUpload(poster);
			if (reason) invalid(issue.posterFile(reason));
			params.posterFile = await toPosterParam(poster);
		}

		await updateBandEvent(data.eventId, band.id, params);

		const lineup = parseLineupField(data.lineup);
		if (lineup) {
			await setEventLineup(data.eventId, lineup, { actingBandId: band.id });
		}

		return { success: true };
	}
);

export const publishBandEvent = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const { band } = await requireBandAdmin();

	const evt = await getById(data.eventId);
	if (!evt || evt.bandId !== band.id) throw error(404, 'Event not found');

	await publish(data.eventId);
	return { success: true };
});

export const unpublishBandEvent = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const { band } = await requireBandAdmin();

	const evt = await getById(data.eventId);
	if (!evt || evt.bandId !== band.id) throw error(404, 'Event not found');

	await unpublish(data.eventId);
	return { success: true };
});

export const cancelBandEventForm = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const { band } = await requireBandAdmin();

	await cancelBandEvent(data.eventId, band.id);
	return { success: true };
});

export const removeBandEventPoster = form(
	z.object({ eventId: z.string().min(1) }),
	async (data) => {
		const { band } = await requireBandAdmin();
		await clearBandEventPoster(data.eventId, band.id);
		return { success: true };
	}
);

/**
 * Bulk-backfill past gigs from a pasted block.
 *
 * Parsed with the same `parseGigImport` the modal previews with, so what the
 * band saw before submitting is what gets written. Rows with errors are
 * dropped rather than failing the whole paste — a single bad date shouldn't
 * cost someone a hundred hand-typed lines.
 */
export const importGigsForm = form(
	z.object({ text: z.string().min(1).max(80_000) }),
	async (data, issue) => {
		const { user, band } = await requireBandAdmin();

		const { rows, errors } = parseGigImport(data.text);
		if (rows.length === 0) {
			invalid(issue.text(errors[0]?.message ?? 'Nothing to import.'));
		}

		const tz = DEFAULT_TIMEZONE;
		const imported = await importBandEvents(
			band.id,
			user.id,
			rows.map((r) => ({
				title: r.title,
				startsAt: buildDateInTz(r.date, GIG_IMPORT_DEFAULT_START, tz),
				location: r.location,
				externalTicketUrl: r.externalTicketUrl,
				support: r.support
			}))
		);

		return { imported, skipped: errors.length };
	}
);

/**
 * Accept a spot on someone else's bill. Only now does the show reach this
 * band's public profile — before this, the credit exists on the event only.
 */
export const confirmLineupSlotForm = form(
	z.object({ eventId: z.string().min(1) }),
	async (data) => {
		const { band } = await requireBandAdmin();
		await confirmLineupSlot(data.eventId, band.id);
		return { success: true };
	}
);

/**
 * Decline a spot. The owner's listing keeps the name as plain text — their
 * record of their own show stays accurate — but it no longer links here, and
 * the partial unique index stops them re-inviting.
 */
export const declineLineupSlotForm = form(
	z.object({ eventId: z.string().min(1) }),
	async (data) => {
		const { band } = await requireBandAdmin();
		await declineLineupSlot(data.eventId, band.id);
		return { success: true };
	}
);
