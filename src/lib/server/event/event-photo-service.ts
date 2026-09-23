import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { eventListing } from '$lib/server/db/schema/event';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { DomainError } from '$lib/server/domain-error';
import { attach, detach, listFor, record, setDescription } from '$lib/server/media/media-service';
import { resolveImageUrl, uploadFile, validateUpload } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';

/**
 * Recap photos: an event's `gallery` slot on `media_attachment`.
 * docs/specs/event-recaps-spec.md. Identity is the remote's guard; this owns
 * the rules — when a gallery is open, how large it may grow, and scoping every
 * attachment id to the event it is presented with.
 */

export const MAX_PHOTOS_PER_EVENT = 60;
export const MAX_PHOTOS_PER_UPLOAD = 10;

const SLOT = 'gallery';

export class RecapClosedError extends DomainError {
	readonly httpStatus = 409;
}

export class RecapPhotoLimitError extends DomainError {
	readonly httpStatus = 422;
}

export class RecapPhotoNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Photo not found');
	}
}

export class RecapUploadError extends DomainError {
	readonly httpStatus = 400;
}

export type EventPhoto = {
	attachmentId: string;
	key: string;
	url: string | null;
	filename: string | null;
	altText: string | null;
	caption: string | null;
};

/** Why photos cannot be added yet, or null when they can. */
export function recapClosedReason(
	evt: { status: string; startsAt: Date },
	now: Date = new Date()
): string | null {
	if (evt.status === 'cancelled') return 'A cancelled event has no recap.';
	if (evt.startsAt.getTime() > now.getTime()) return 'Photos open once the event has started.';
	return null;
}

export async function listEventPhotos(eventId: string): Promise<EventPhoto[]> {
	const rows = await listFor('event_listing', eventId, SLOT);
	return rows.map((r) => ({
		attachmentId: r.attachmentId,
		key: r.key,
		url: resolveImageUrl(r.key),
		filename: r.filename,
		altText: r.altText,
		caption: r.caption
	}));
}

/** Validates every file before uploading any, so a bad batch leaves nothing behind. */
export async function addEventPhotos(
	eventId: string,
	userId: string,
	files: File[],
	now: Date = new Date()
): Promise<void> {
	const [evt] = await db
		.select({ status: eventListing.status, startsAt: eventListing.startsAt })
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!evt) throw new RecapPhotoNotFoundError();

	const closed = recapClosedReason(evt, now);
	if (closed) throw new RecapClosedError(closed);

	if (files.length === 0) throw new RecapUploadError('Choose at least one photo.');
	if (files.length > MAX_PHOTOS_PER_UPLOAD) {
		throw new RecapUploadError(`At most ${MAX_PHOTOS_PER_UPLOAD} photos per upload.`);
	}
	for (const file of files) {
		const reason = validateUpload(file);
		if (reason) throw new RecapUploadError(`${file.name}: ${reason}`);
	}

	const existing = await listFor('event_listing', eventId, SLOT);
	if (existing.length + files.length > MAX_PHOTOS_PER_EVENT) {
		throw new RecapPhotoLimitError(
			`An event holds at most ${MAX_PHOTOS_PER_EVENT} photos; this one has ${existing.length}.`
		);
	}

	let sortOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
	for (const file of files) {
		const buffer = await file.arrayBuffer();
		const key = mediaKey('events/photos', eventId, file.type);
		await uploadFile(buffer, key, file.type);
		const row = await record({
			key,
			contentType: file.type,
			byteSize: buffer.byteLength,
			filename: file.name,
			uploadedByUserId: userId
		});
		await attach({
			mediaId: row.id,
			attachableType: 'event_listing',
			attachableId: eventId,
			slot: SLOT,
			sortOrder: sortOrder++
		});
	}
}

/** The attachment's media id, or a 404 when it is not this event's photo. */
async function scopedMediaId(eventId: string, attachmentId: string): Promise<string> {
	const [row] = await db
		.select({ mediaId: mediaAttachment.mediaId })
		.from(mediaAttachment)
		.where(
			and(
				eq(mediaAttachment.id, attachmentId),
				eq(mediaAttachment.attachableType, 'event_listing'),
				eq(mediaAttachment.attachableId, eventId),
				eq(mediaAttachment.slot, SLOT)
			)
		)
		.limit(1);
	if (!row) throw new RecapPhotoNotFoundError();
	return row.mediaId;
}

/** Detach only; the media sweep reclaims the object once nothing points at it. */
export async function removeEventPhoto(eventId: string, attachmentId: string): Promise<void> {
	await scopedMediaId(eventId, attachmentId);
	await detach(attachmentId);
}

export async function describeEventPhoto(
	eventId: string,
	attachmentId: string,
	input: { altText?: string | null; caption?: string | null }
): Promise<void> {
	await setDescription(await scopedMediaId(eventId, attachmentId), input);
}

export type RecapCard = {
	id: string;
	title: string;
	startsAt: Date;
	coverUrl: string | null;
	photoCount: number;
};

/**
 * Past published events with at least one photo, newest first. The join to
 * `event_listing` is what keeps orphaned attachments out. The cover is the
 * lowest `sort_order`: SQLite returns a bare column from the `min()` row.
 */
export async function listRecentRecaps(limit = 6, now: Date = new Date()): Promise<RecapCard[]> {
	const rows = await db
		.select({
			id: eventListing.id,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			firstOrder: sql<number>`min(${mediaAttachment.sortOrder})`,
			coverKey: media.key,
			photoCount: sql<number>`count(*)`
		})
		.from(eventListing)
		.innerJoin(
			mediaAttachment,
			and(
				eq(mediaAttachment.attachableType, 'event_listing'),
				eq(mediaAttachment.attachableId, eventListing.id),
				eq(mediaAttachment.slot, SLOT)
			)
		)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(and(eq(eventListing.status, 'published'), lte(eventListing.startsAt, now)))
		.groupBy(eventListing.id)
		.orderBy(desc(eventListing.startsAt))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		startsAt: r.startsAt,
		coverUrl: resolveImageUrl(r.coverKey),
		photoCount: Number(r.photoCount)
	}));
}
