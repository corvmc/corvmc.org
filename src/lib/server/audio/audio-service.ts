/**
 * Releases and tracks: what a band has put out, and what is in it.
 *
 * Queries and mutations are separated below, per the layering rule. Everything
 * here takes ids the caller has already been authorized for — the guard lives in
 * `audio.remote.ts`, and nothing in this module checks who is asking.
 */
import { db } from '$lib/server/db';
import {
	audioRelease,
	audioTrack,
	releasePurchase,
	type ReleaseStatus
} from '$lib/server/db/schema/audio';
import { group } from '$lib/server/db/schema/group';
import { mediaAttachment, media } from '$lib/server/db/schema/media';
import { and, asc, count, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { deleteAudioObject } from './audio-storage';
import { detachSlot } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import { AUDIO_MIN_PRICE_CENTS, type ReleaseKind } from '$lib/config';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ReleaseNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Release not found');
	}
}

export class TrackNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Track not found');
	}
}

/** The gap between free and the charge floor — see `AUDIO_MIN_PRICE_CENTS`. */
export class UnsellablePriceError extends DomainError {
	readonly httpStatus = 400;
	constructor() {
		super(
			`A release is free, or at least $${(AUDIO_MIN_PRICE_CENTS / 100).toFixed(2)}. Below that, card fees take almost all of it.`
		);
	}
}

export class EmptyReleaseError extends DomainError {
	readonly httpStatus = 400;
	constructor() {
		super('Add at least one track before publishing.');
	}
}

/** A takedown is not a draft. Only staff move a release out of `withheld`. */
export class ReleaseWithheldError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('This release was withheld by CMC staff. Reply to their message to sort it out.');
	}
}

export class ReleaseHasSalesError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This release has been bought. It can be unpublished, but not deleted.');
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The release's cover, resolved through the transform pipeline. `null` when unset. */
async function coverUrlsFor(releaseIds: string[]): Promise<Map<string, string>> {
	if (releaseIds.length === 0) return new Map();

	const rows = await db
		.select({ releaseId: mediaAttachment.attachableId, key: media.key })
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(
			and(
				eq(mediaAttachment.attachableType, 'audio_release'),
				eq(mediaAttachment.slot, 'cover'),
				inArray(mediaAttachment.attachableId, releaseIds)
			)
		);

	const map = new Map<string, string>();
	for (const row of rows) {
		const url = resolveImageUrl(row.key);
		if (url) map.set(row.releaseId, url);
	}
	return map;
}

export type ReleaseSummary = {
	id: string;
	title: string;
	slug: string;
	kind: ReleaseKind;
	status: ReleaseStatus;
	priceMinCents: number;
	allowPayMore: boolean;
	radioOptIn: boolean;
	radioExcluded: boolean;
	radioExcludedReason: string | null;
	releasedAt: Date | null;
	publishedAt: Date | null;
	coverUrl: string | null;
	trackCount: number;
	/** Total runtime, so the list can say "4 tracks · 18 min" without a second read. */
	durationMs: number;
	salesCount: number;
};

/**
 * A band's whole discography, drafts included.
 *
 * The three aggregates are correlated subqueries rather than three joins with a
 * GROUP BY, because two of them fan out independently — joining tracks and
 * purchases in one statement multiplies each by the other and every sum comes
 * back wrong in a way that looks plausible.
 */
export async function listReleasesForBand(groupId: string): Promise<ReleaseSummary[]> {
	const rows = await db
		.select({
			id: audioRelease.id,
			title: audioRelease.title,
			slug: audioRelease.slug,
			kind: audioRelease.kind,
			status: audioRelease.status,
			priceMinCents: audioRelease.priceMinCents,
			allowPayMore: audioRelease.allowPayMore,
			radioOptIn: audioRelease.radioOptIn,
			radioExcludedAt: audioRelease.radioExcludedAt,
			radioExcludedReason: audioRelease.radioExcludedReason,
			releasedAt: audioRelease.releasedAt,
			publishedAt: audioRelease.publishedAt,
			trackCount: sql<number>`(SELECT COUNT(*) FROM ${audioTrack} WHERE ${audioTrack.releaseId} = ${audioRelease.id})`,
			durationMs: sql<number>`COALESCE((SELECT SUM(${audioTrack.durationMs}) FROM ${audioTrack} WHERE ${audioTrack.releaseId} = ${audioRelease.id}), 0)`,
			salesCount: sql<number>`(SELECT COUNT(*) FROM ${releasePurchase} WHERE ${releasePurchase.releaseId} = ${audioRelease.id} AND ${releasePurchase.status} = 'paid')`
		})
		.from(audioRelease)
		.where(and(eq(audioRelease.groupId, groupId), isNull(audioRelease.deletedAt)))
		.orderBy(desc(audioRelease.releasedAt), desc(audioRelease.createdAt));

	const covers = await coverUrlsFor(rows.map((r) => r.id));

	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		slug: r.slug,
		kind: r.kind,
		status: r.status,
		priceMinCents: r.priceMinCents,
		allowPayMore: r.allowPayMore,
		radioOptIn: r.radioOptIn,
		radioExcluded: r.radioExcludedAt !== null,
		radioExcludedReason: r.radioExcludedReason,
		releasedAt: r.releasedAt,
		publishedAt: r.publishedAt,
		coverUrl: covers.get(r.id) ?? null,
		trackCount: Number(r.trackCount),
		durationMs: Number(r.durationMs),
		salesCount: Number(r.salesCount)
	}));
}

export async function getReleaseById(releaseId: string) {
	const [row] = await db
		.select()
		.from(audioRelease)
		.where(and(eq(audioRelease.id, releaseId), isNull(audioRelease.deletedAt)))
		.limit(1);
	return row ?? null;
}

/** The release plus its band, for a public page that starts from a slug pair. */
export async function getPublishedRelease(bandSlug: string, releaseSlug: string) {
	const [row] = await db
		.select({
			release: audioRelease,
			bandId: group.id,
			bandName: group.name,
			bandSlug: group.slug
		})
		.from(audioRelease)
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(
			and(
				eq(group.slug, bandSlug),
				eq(audioRelease.slug, releaseSlug),
				eq(audioRelease.status, 'published'),
				isNull(audioRelease.deletedAt),
				isNull(group.deletedAt)
			)
		)
		.limit(1);
	return row ?? null;
}

export async function listTracks(releaseId: string) {
	return db
		.select({
			id: audioTrack.id,
			title: audioTrack.title,
			trackNumber: audioTrack.trackNumber,
			durationMs: audioTrack.durationMs,
			byteSize: audioTrack.byteSize,
			contentType: audioTrack.contentType,
			radioExcludedAt: audioTrack.radioExcludedAt
		})
		.from(audioTrack)
		.where(eq(audioTrack.releaseId, releaseId))
		.orderBy(asc(audioTrack.trackNumber));
}

/**
 * One track, with everything the stream endpoint needs to decide whether to
 * serve it — in a single read, because that endpoint is on the hot path for
 * every listener and every seek.
 */
export async function getStreamableTrack(trackId: string) {
	const [row] = await db
		.select({
			objectKey: audioTrack.objectKey,
			contentType: audioTrack.contentType,
			byteSize: audioTrack.byteSize,
			status: audioRelease.status,
			releaseDeletedAt: audioRelease.deletedAt,
			bandDeletedAt: group.deletedAt
		})
		.from(audioTrack)
		.innerJoin(audioRelease, eq(audioRelease.id, audioTrack.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(eq(audioTrack.id, trackId))
		.limit(1);

	if (!row) return null;
	// Streaming is the one place a `withheld` release must behave exactly like a
	// missing one: a takedown that still serves bytes is not a takedown.
	const live = row.status === 'published' && !row.releaseDeletedAt && !row.bandDeletedAt;
	return live ? row : null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * A slug unique within the band, suffixed if taken.
 *
 * Band-scoped rather than global, which is why this cannot reuse
 * `ensureUniqueSlug` from `band-service`: two bands may both have a "Demos" and
 * `/music/sour-cherry/demos` still resolves.
 */
async function uniqueSlug(groupId: string, title: string, exceptId?: string): Promise<string> {
	const base =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60) || 'untitled';

	const taken = await db
		.select({ slug: audioRelease.slug, id: audioRelease.id })
		.from(audioRelease)
		.where(eq(audioRelease.groupId, groupId));

	const used = new Set(taken.filter((r) => r.id !== exceptId).map((r) => r.slug));
	if (!used.has(base)) return base;

	for (let n = 2; n < 500; n++) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function assertSellablePrice(priceMinCents: number) {
	if (priceMinCents !== 0 && priceMinCents < AUDIO_MIN_PRICE_CENTS)
		throw new UnsellablePriceError();
}

export type CreateReleaseData = {
	groupId: string;
	title: string;
	kind: ReleaseKind;
	description?: string | null;
	releasedAt?: Date | null;
};

export async function createRelease(data: CreateReleaseData) {
	const slug = await uniqueSlug(data.groupId, data.title);
	const [row] = await db
		.insert(audioRelease)
		.values({
			groupId: data.groupId,
			title: data.title,
			slug,
			kind: data.kind,
			description: data.description ?? null,
			releasedAt: data.releasedAt ?? null
		})
		.returning();
	return row;
}

export type UpdateReleaseData = {
	title?: string;
	kind?: ReleaseKind;
	description?: string | null;
	releasedAt?: Date | null;
	priceMinCents?: number;
	allowPayMore?: boolean;
	radioOptIn?: boolean;
};

export async function updateRelease(releaseId: string, data: UpdateReleaseData) {
	const existing = await getReleaseById(releaseId);
	if (!existing) throw new ReleaseNotFoundError();
	if (data.priceMinCents !== undefined) assertSellablePrice(data.priceMinCents);

	// The slug follows the title only while nothing has linked to it yet.
	// Renaming a published record would break every flyer and every purchase
	// email already carrying the old address.
	const slug =
		data.title && data.title !== existing.title && existing.status === 'draft'
			? await uniqueSlug(existing.groupId, data.title, releaseId)
			: existing.slug;

	const [row] = await db
		.update(audioRelease)
		.set({ ...data, slug, updatedAt: new Date() })
		.where(eq(audioRelease.id, releaseId))
		.returning();
	return row;
}

export async function publishRelease(releaseId: string) {
	const existing = await getReleaseById(releaseId);
	if (!existing) throw new ReleaseNotFoundError();
	if (existing.status === 'withheld') throw new ReleaseWithheldError();

	const [{ value: tracks }] = await db
		.select({ value: count() })
		.from(audioTrack)
		.where(eq(audioTrack.releaseId, releaseId));
	if (tracks === 0) throw new EmptyReleaseError();

	const [row] = await db
		.update(audioRelease)
		.set({
			status: 'published',
			// First publish stamps the date; re-publishing after a pull keeps the
			// original, which is what the discography orders by.
			publishedAt: existing.publishedAt ?? new Date(),
			updatedAt: new Date()
		})
		.where(eq(audioRelease.id, releaseId))
		.returning();
	return row;
}

export async function unpublishRelease(releaseId: string) {
	const existing = await getReleaseById(releaseId);
	if (!existing) throw new ReleaseNotFoundError();
	if (existing.status === 'withheld') throw new ReleaseWithheldError();

	const [row] = await db
		.update(audioRelease)
		.set({ status: 'draft', updatedAt: new Date() })
		.where(eq(audioRelease.id, releaseId))
		.returning();
	return row;
}

/**
 * Remove a release, and only really remove it when nobody has bought it.
 *
 * A sold record is soft-deleted: its buyers' entitlements hang off this row, and
 * a band must not be able to reach into somebody's library and empty it. The
 * objects stay for the same reason. Same argument that keeps a `band_site` row
 * alive through a lapsed subscription.
 */
export async function deleteRelease(releaseId: string): Promise<'deleted' | 'archived'> {
	const existing = await getReleaseById(releaseId);
	if (!existing) throw new ReleaseNotFoundError();

	const [{ value: sales }] = await db
		.select({ value: count() })
		.from(releasePurchase)
		.where(and(eq(releasePurchase.releaseId, releaseId), eq(releasePurchase.status, 'paid')));

	if (sales > 0) {
		await db
			.update(audioRelease)
			.set({ status: 'draft', deletedAt: new Date(), updatedAt: new Date() })
			.where(eq(audioRelease.id, releaseId));
		return 'archived';
	}

	// Objects first, then rows. The row is the only record of the key, so
	// deleting it first and then failing on R2 strands a file that is billed
	// forever with nothing left pointing at it — the same ordering, and the same
	// reason, as the media sweep.
	const tracks = await db
		.select({ objectKey: audioTrack.objectKey })
		.from(audioTrack)
		.where(eq(audioTrack.releaseId, releaseId));
	for (const track of tracks) await deleteAudioObject(track.objectKey);

	// The cover is a shared-by-design `media` row, so it is detached, never
	// deleted — the sweep decides whether the object survives.
	await detachSlot('audio_release', releaseId, 'cover');
	await db.delete(audioRelease).where(eq(audioRelease.id, releaseId));
	return 'deleted';
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export async function nextTrackNumber(releaseId: string): Promise<number> {
	const [row] = await db
		.select({ highest: max(audioTrack.trackNumber) })
		.from(audioTrack)
		.where(eq(audioTrack.releaseId, releaseId));
	return (row?.highest ?? 0) + 1;
}

export type AddTrackData = {
	releaseId: string;
	title: string;
	trackNumber: number;
	durationMs: number;
	objectKey: string;
	contentType: string;
	byteSize: number;
	originalFilename: string | null;
};

export async function addTrack(data: AddTrackData) {
	const [row] = await db.insert(audioTrack).values(data).returning();
	return row;
}

export async function renameTrack(trackId: string, title: string) {
	const [row] = await db
		.update(audioTrack)
		.set({ title, updatedAt: new Date() })
		.where(eq(audioTrack.id, trackId))
		.returning();
	if (!row) throw new TrackNotFoundError();
	return row;
}

export async function getTrackWithRelease(trackId: string) {
	const [row] = await db
		.select({ track: audioTrack, release: audioRelease })
		.from(audioTrack)
		.innerJoin(audioRelease, eq(audioRelease.id, audioTrack.releaseId))
		.where(eq(audioTrack.id, trackId))
		.limit(1);
	return row ?? null;
}

/**
 * Delete a track and close the gap its number left.
 *
 * The renumber is not cosmetic: `(release_id, track_number)` is unique, so
 * leaving a hole means the next upload lands at `n+1` and the sixth track of a
 * five-track record is numbered 7. Sequential updates rather than one statement
 * because SQLite checks the unique index per row, and shifting 3→2 while 2 still
 * exists is a conflict — ascending order is what makes each step legal.
 */
export async function deleteTrack(trackId: string): Promise<void> {
	const found = await getTrackWithRelease(trackId);
	if (!found) throw new TrackNotFoundError();

	await deleteAudioObject(found.track.objectKey);
	await db.delete(audioTrack).where(eq(audioTrack.id, trackId));

	const remaining = await db
		.select({ id: audioTrack.id, trackNumber: audioTrack.trackNumber })
		.from(audioTrack)
		.where(eq(audioTrack.releaseId, found.track.releaseId))
		.orderBy(asc(audioTrack.trackNumber));

	for (let i = 0; i < remaining.length; i++) {
		const wanted = i + 1;
		if (remaining[i].trackNumber === wanted) continue;
		await db
			.update(audioTrack)
			.set({ trackNumber: wanted })
			.where(eq(audioTrack.id, remaining[i].id));
	}
}

/**
 * Reorder a release's tracks to the given id sequence.
 *
 * Two passes, and the first one is why this is not a loop. `(release_id,
 * track_number)` is unique, so any permutation that swaps two tracks collides
 * partway through — moving 1→2 while 2 is still 2 fails. Parking every row at a
 * negative number first vacates the whole range, and negatives are safe because
 * nothing else ever writes one.
 */
export async function reorderTracks(releaseId: string, orderedIds: string[]): Promise<void> {
	const existing = await db
		.select({ id: audioTrack.id })
		.from(audioTrack)
		.where(eq(audioTrack.releaseId, releaseId));

	const known = new Set(existing.map((t) => t.id));
	const wanted = orderedIds.filter((id) => known.has(id));
	// Anything the client omitted keeps its relative position at the end, so a
	// stale page cannot silently drop a track that was uploaded meanwhile.
	for (const track of existing) if (!wanted.includes(track.id)) wanted.push(track.id);

	await db.batch([
		...wanted.map((id, i) =>
			db
				.update(audioTrack)
				.set({ trackNumber: -(i + 1) })
				.where(and(eq(audioTrack.id, id), eq(audioTrack.releaseId, releaseId)))
		)
	] as never);

	await db.batch([
		...wanted.map((id, i) =>
			db
				.update(audioTrack)
				.set({ trackNumber: i + 1, updatedAt: new Date() })
				.where(and(eq(audioTrack.id, id), eq(audioTrack.releaseId, releaseId)))
		)
	] as never);
}
