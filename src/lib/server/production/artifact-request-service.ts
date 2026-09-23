import { db } from '$lib/server/db';
import { artifactRequest } from '$lib/server/db/schema/artifact-request';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { eventBand, eventListing } from '$lib/server/db/schema/event';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { venue } from '$lib/server/db/schema/venue';
import { and, asc, eq, inArray, isNull, like } from 'drizzle-orm';
import { getEventRiderSummaries } from '$lib/server/band/rider-service';
import { attachExisting, listAttachedEntries, replaceSlot } from '$lib/server/media/media-service';
import { resolveImageUrl, uploadFile } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';
import { DomainError } from '$lib/server/domain-error';
import { SEARCH_LIMIT, type RequestableArtifact } from '$lib/config';
import type { OutstandingRequest, PosterAsk } from '$lib/types/artifact-request';

export type { OutstandingRequest, PosterAsk };

/** One 404 for every way a poster ask can be unusable, so none can be probed. */
export class PosterRequestNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That request is not open any more');
	}
}

const POSTER_ART_TYPES = ['image/jpeg', 'image/png'];

/**
 * Asking an act for something, and knowing whether it came.
 *
 * Arrival is derived, never stored — a rider filled in unprompted still counts,
 * and nothing has to be marked done by hand.
 */

export async function requestArtifact(input: {
	eventId: string;
	entryId: string;
	artifact: RequestableArtifact;
	dueAt?: Date | null;
	requestedByUserId?: string | null;
}): Promise<void> {
	// Asking again is a reminder rather than a second request, so a repeat
	// updates the deadline instead of adding a row the outstanding count would
	// then double.
	await db
		.insert(artifactRequest)
		.values({
			eventId: input.eventId,
			entryId: input.entryId,
			artifact: input.artifact,
			dueAt: input.dueAt ?? null,
			requestedByUserId: input.requestedByUserId ?? null
		})
		.onConflictDoUpdate({
			target: [artifactRequest.eventId, artifactRequest.entryId, artifactRequest.artifact],
			set: { dueAt: input.dueAt ?? null, requestedAt: new Date(), cancelledAt: null }
		});
}

export async function cancelArtifactRequest(id: string): Promise<void> {
	await db
		.update(artifactRequest)
		.set({ cancelledAt: new Date() })
		.where(eq(artifactRequest.id, id));
}

/**
 * What a show is still waiting on.
 *
 * A tech rider is the summary the Advance tab computes **or** a file on the
 * listing — `rider` is keyed on `group_id`, so for an act with no account the
 * summary is always empty and the file is the only answer (#863). A press kit
 * is a listing with a bio. Poster art is a file attached to the request.
 */
export async function listRequests(
	eventId: string,
	now = new Date()
): Promise<OutstandingRequest[]> {
	const rows = await db
		.select({
			id: artifactRequest.id,
			entryId: artifactRequest.entryId,
			artifact: artifactRequest.artifact,
			dueAt: artifactRequest.dueAt,
			requestedAt: artifactRequest.requestedAt,
			// The listing's own name, not the credit's copy of it: a request is
			// against the listing, and an artist commissioned for poster art has one
			// without ever being on the bill.
			actName: directoryEntry.name,
			bio: directoryEntry.bio
		})
		.from(artifactRequest)
		.innerJoin(directoryEntry, eq(directoryEntry.id, artifactRequest.entryId))
		.where(and(eq(artifactRequest.eventId, eventId), isNull(artifactRequest.cancelledAt)));

	if (rows.length === 0) return [];

	const wantsRider = rows.some((r) => r.artifact === 'tech_rider');
	const posterIds = rows.filter((r) => r.artifact === 'poster_art').map((r) => r.id);

	// One read for every rider on the bill, rather than one per request, and one
	// more for the files — both are a single statement over the whole bill.
	const [riders, riderFiles, delivered] = await Promise.all([
		wantsRider ? getEventRiderSummaries(eventId) : Promise.resolve([]),
		wantsRider
			? listAttachedEntries(
					'directory_entry',
					rows.filter((r) => r.artifact === 'tech_rider').map((r) => r.entryId),
					'rider'
				)
			: Promise.resolve(new Set<string>()),
		deliveredKeys(posterIds)
	]);
	const riderArrived = new Map(riders.map((r) => [r.name, !r.empty]));

	return rows.map((r) => {
		const deliveredKey = delivered.get(r.id) ?? null;
		const fulfilled =
			r.artifact === 'tech_rider'
				? (riderArrived.get(r.actName ?? '') ?? false) || riderFiles.has(r.entryId)
				: r.artifact === 'epk'
					? Boolean(r.bio && r.bio.trim().length > 0)
					: deliveredKey !== null;
		return {
			deliveredUrl: resolveImageUrl(deliveredKey),
			id: r.id,
			entryId: r.entryId,
			actName: r.actName,
			artifact: r.artifact,
			dueAt: r.dueAt,
			requestedAt: r.requestedAt,
			fulfilled,
			overdue: !fulfilled && r.dueAt !== null && r.dueAt < now
		};
	});
}

/** What is still owed across the whole bill — the number staff act on. */
export async function outstandingCount(eventId: string, now = new Date()): Promise<number> {
	return (await listRequests(eventId, now)).filter((r) => !r.fulfilled).length;
}

/**
 * Who a request can be sent to.
 *
 * Off `event_band` rather than `production_slot`: an act can be asked for its
 * rider before anyone opens a run of show, and a credit with no listing has
 * nowhere to receive one.
 */
export async function requestableActs(
	eventId: string
): Promise<{ entryId: string; name: string }[]> {
	const rows = await db
		.select({ entryId: eventBand.directoryEntryId, name: eventBand.name })
		.from(eventBand)
		.where(eq(eventBand.eventId, eventId))
		.orderBy(asc(eventBand.billingOrder));

	return rows
		.filter((r): r is { entryId: string; name: string } => r.entryId !== null)
		.map((r) => ({ entryId: r.entryId, name: r.name }));
}

/**
 * Anyone with a listing, bill or no bill. An artist commissioned for a poster
 * is a member's entry or an external one, and is never on `event_band`.
 */
export async function searchAskableEntries(q: string): Promise<{ id: string; name: string }[]> {
	if (q.trim().length < 2) return [];
	return db
		.select({ id: directoryEntry.id, name: directoryEntry.name })
		.from(directoryEntry)
		.where(and(like(directoryEntry.name, `%${q.trim()}%`), isNull(directoryEntry.deletedAt)))
		.orderBy(asc(directoryEntry.name))
		.limit(SEARCH_LIMIT);
}

/** Request id → the key of the poster art delivered against it. */
async function deliveredKeys(requestIds: string[]): Promise<Map<string, string>> {
	if (requestIds.length === 0) return new Map();
	const rows = await db
		.select({ requestId: mediaAttachment.attachableId, key: media.key })
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(
			and(
				eq(mediaAttachment.attachableType, 'artifact_request'),
				inArray(mediaAttachment.attachableId, requestIds),
				eq(mediaAttachment.slot, 'poster')
			)
		);
	return new Map(rows.map((r) => [r.requestId, r.key]));
}

/** What an artist has been asked to draw, with the show it is for. */
export async function livePosterRequests(entryId: string): Promise<PosterAsk[]> {
	const rows = await db
		.select({
			id: artifactRequest.id,
			eventId: artifactRequest.eventId,
			dueAt: artifactRequest.dueAt,
			eventTitle: eventListing.title,
			startsAt: eventListing.startsAt,
			venueName: venue.name,
			location: eventListing.location
		})
		.from(artifactRequest)
		.innerJoin(eventListing, eq(eventListing.id, artifactRequest.eventId))
		.leftJoin(venue, eq(venue.id, eventListing.venueId))
		.where(
			and(
				eq(artifactRequest.entryId, entryId),
				eq(artifactRequest.artifact, 'poster_art'),
				isNull(artifactRequest.cancelledAt)
			)
		)
		.orderBy(asc(eventListing.startsAt));
	if (rows.length === 0) return [];

	const [delivered, credits] = await Promise.all([
		deliveredKeys(rows.map((r) => r.id)),
		db
			.select({ eventId: eventBand.eventId, name: eventBand.name })
			.from(eventBand)
			.where(
				inArray(
					eventBand.eventId,
					rows.map((r) => r.eventId)
				)
			)
			.orderBy(asc(eventBand.billingOrder))
	]);

	return rows.map((r) => ({
		id: r.id,
		eventTitle: r.eventTitle,
		startsAt: r.startsAt,
		venue: r.venueName ?? r.location,
		bill: credits.filter((c) => c.eventId === r.eventId).map((c) => c.name),
		dueAt: r.dueAt,
		deliveredUrl: resolveImageUrl(delivered.get(r.id))
	}));
}

/**
 * The artist's file, against their own live ask. Checked before the upload so
 * a refused request leaves no object behind. A second delivery replaces the
 * first; the caption is the credit.
 */
export async function deliverPosterArt(input: {
	entryId: string;
	requestId: string;
	file: { buffer: ArrayBuffer; contentType: string; filename: string | null };
}): Promise<void> {
	const [req] = await db
		.select({ id: artifactRequest.id, artist: directoryEntry.name })
		.from(artifactRequest)
		.innerJoin(directoryEntry, eq(directoryEntry.id, artifactRequest.entryId))
		.where(
			and(
				eq(artifactRequest.id, input.requestId),
				eq(artifactRequest.entryId, input.entryId),
				eq(artifactRequest.artifact, 'poster_art'),
				isNull(artifactRequest.cancelledAt)
			)
		)
		.limit(1);
	if (!req) throw new PosterRequestNotFoundError();

	const key = mediaKey('acts/poster-art', req.id, input.file.contentType);
	await uploadFile(input.file.buffer, key, input.file.contentType, POSTER_ART_TYPES);
	await replaceSlot({
		attachableType: 'artifact_request',
		attachableId: req.id,
		slot: 'poster',
		key,
		contentType: input.file.contentType,
		byteSize: input.file.buffer.byteLength,
		filename: input.file.filename,
		caption: `Poster art by ${req.artist}`
	});
}

/** The art delivered against a request, and the show it is for. */
export async function deliveredPosterArt(
	requestId: string
): Promise<{ eventId: string; key: string }> {
	const [req] = await db
		.select({ eventId: artifactRequest.eventId })
		.from(artifactRequest)
		.where(eq(artifactRequest.id, requestId))
		.limit(1);
	const key = req ? (await deliveredKeys([requestId])).get(requestId) : undefined;
	if (!req || !key) throw new PosterRequestNotFoundError();
	return { eventId: req.eventId, key };
}

/** Point the event's poster at the delivered art — the same object, not a copy. */
export async function promotePosterArt(requestId: string): Promise<{ eventId: string }> {
	const { eventId, key } = await deliveredPosterArt(requestId);
	await attachExisting('event_listing', eventId, 'poster', key);
	return { eventId };
}
