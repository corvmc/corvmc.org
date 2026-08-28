import { db } from '$lib/server/db';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import type { AttachableType, MediaSlot } from '$lib/server/db/schema/media';
import { event } from '$lib/server/db/schema/event';
import { group } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordMediaInput = {
	key: string;
	contentType: string;
	byteSize: number;
	filename?: string | null;
	altText?: string | null;
	caption?: string | null;
	uploadedByUserId?: string | null;
};

export type AttachInput = {
	mediaId: string;
	attachableType: AttachableType;
	attachableId: string;
	slot: MediaSlot;
	sortOrder?: number;
};

/** A `media` row joined to the attachment that surfaced it. */
export type AttachedMedia = {
	attachmentId: string;
	mediaId: string;
	key: string;
	contentType: string;
	byteSize: number;
	filename: string | null;
	altText: string | null;
	caption: string | null;
	slot: MediaSlot;
	sortOrder: number;
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record an object that has already been uploaded to R2.
 *
 * Deliberately separate from `attach`: an upload that is never attached is a
 * real state — the row exists so the sweep can find the object and delete it —
 * and collapsing the two would make the orphan unreachable in exactly the way
 * `band_media` is today.
 */
export async function record(input: RecordMediaInput) {
	const [row] = await db
		.insert(media)
		.values({
			key: input.key,
			contentType: input.contentType,
			byteSize: input.byteSize,
			filename: input.filename ?? null,
			altText: input.altText ?? null,
			caption: input.caption ?? null,
			uploadedByUserId: input.uploadedByUserId ?? null
		})
		.returning();
	return row;
}

/** Point a parent at an object. Many parents may point at the same one. */
export async function attach(input: AttachInput) {
	const [row] = await db
		.insert(mediaAttachment)
		.values({
			mediaId: input.mediaId,
			attachableType: input.attachableType,
			attachableId: input.attachableId,
			slot: input.slot,
			sortOrder: input.sortOrder ?? 0
		})
		.returning();
	return row;
}

/**
 * Drop one usage. The object and its `media` row survive — a sibling occurrence
 * may still be using them, and deciding otherwise is the sweep's job, which is
 * the only writer that can see the whole reference graph at once.
 *
 * Nothing here calls `deleteObject`. That is the rule the module exists to hold:
 * an R2 object is never deleted as a side effect of deleting a row.
 */
export async function detach(attachmentId: string) {
	await db.delete(mediaAttachment).where(eq(mediaAttachment.id, attachmentId));
}

/** Drop every usage in one slot — replacing a single-image slot like an avatar. */
export async function detachSlot(
	attachableType: AttachableType,
	attachableId: string,
	slot: MediaSlot
) {
	await db
		.delete(mediaAttachment)
		.where(
			and(
				eq(mediaAttachment.attachableType, attachableType),
				eq(mediaAttachment.attachableId, attachableId),
				eq(mediaAttachment.slot, slot)
			)
		);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * One parent's media, newest slot ordering first.
 *
 * Safe against orphans without any extra predicate, because the caller supplies
 * a parent id it already holds: an orphan belongs to a *deleted* parent and can
 * never match a live one's id.
 */
export async function listFor(
	attachableType: AttachableType,
	attachableId: string,
	slot?: MediaSlot | MediaSlot[]
): Promise<AttachedMedia[]> {
	// Several slots in one statement rather than one call each. A parent's media
	// is a single load-bearing read; fanning it out per slot is the pattern
	// docs/development/conventions.md rules out.
	const slotCondition =
		slot === undefined
			? undefined
			: Array.isArray(slot)
				? inArray(mediaAttachment.slot, slot)
				: eq(mediaAttachment.slot, slot);

	const where = and(
		eq(mediaAttachment.attachableType, attachableType),
		eq(mediaAttachment.attachableId, attachableId),
		slotCondition
	);

	return db
		.select({
			attachmentId: mediaAttachment.id,
			mediaId: media.id,
			key: media.key,
			contentType: media.contentType,
			byteSize: media.byteSize,
			filename: media.filename,
			altText: media.altText,
			caption: media.caption,
			slot: mediaAttachment.slot,
			sortOrder: mediaAttachment.sortOrder
		})
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(where)
		.orderBy(mediaAttachment.sortOrder);
}

/**
 * How many usages an object has. The sweep's question, and the reason `detach`
 * can be unconditional: zero here is what makes an object reapable, not the
 * removal of any one parent.
 */
export async function countAttachments(mediaId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)`.as('n') })
		.from(mediaAttachment)
		.where(eq(mediaAttachment.mediaId, mediaId));
	return Number(row?.n ?? 0);
}

/**
 * The guard for any query that aggregates **across** parents.
 *
 * A per-parent read needs nothing — `listFor` above explains why. What is unsafe
 * is a global sum or count, which sees rows belonging to parents deleted since
 * the last sweep. This returns the `EXISTS` predicate that excludes them, one
 * arm per `attachableType`, so there is a single place that has to be right.
 *
 * Note this is narrower than `docs/specs/media-spec.md` claims: the spec says a
 * per-group quota needs it, and a per-group quota does not, because it filters
 * to a live group's id already. Global reporting totals are the real case.
 */
export function liveAttachmentCondition(): SQL {
	return sql`(
		(${mediaAttachment.attachableType} = 'event'
			AND EXISTS (SELECT 1 FROM ${event} WHERE ${event.id} = ${mediaAttachment.attachableId}))
		OR (${mediaAttachment.attachableType} = 'group'
			AND EXISTS (SELECT 1 FROM ${group} WHERE ${group.id} = ${mediaAttachment.attachableId}))
		OR (${mediaAttachment.attachableType} = 'user'
			AND EXISTS (SELECT 1 FROM ${user} WHERE ${user.id} = ${mediaAttachment.attachableId}))
	)`;
}

/** Total bytes referenced by live attachments. Uses the guard above. */
export async function totalLiveBytes(): Promise<number> {
	const [row] = await db
		.select({ bytes: sql<number>`coalesce(sum(${media.byteSize}), 0)`.as('bytes') })
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(liveAttachmentCondition());
	return Number(row?.bytes ?? 0);
}
