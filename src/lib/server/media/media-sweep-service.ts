import { db } from '$lib/server/db';
import { media, mediaAttachment, attachableTypes } from '$lib/server/db/schema/media';
import type { AttachableType } from '$lib/server/db/schema/media';
import { eventListing } from '$lib/server/db/schema/event';
import {
	acquisition,
	workRequest,
	inventoryAsset,
	inventoryItem
} from '$lib/server/db/schema/inventory';
import { group } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { audioRelease } from '$lib/server/db/schema/audio';
import { deleteObject } from '$lib/server/storage';
import { MEDIA_SWEEP_GRACE_MS } from '$lib/config';
import { and, eq, lt, sql, notExists, inArray, type SQLWrapper } from 'drizzle-orm';

/**
 * The reaper behind the rule in docs/specs/shipped/media-spec.md:
 *
 *   An R2 object is never deleted as a side effect of deleting a row.
 *
 * Nothing in the write path deletes an object, because no single write can see
 * whether a sibling still needs it. This job is the one place that can, and it
 * is a single writer, which is what lets it decide safely on a database with no
 * usable transaction.
 */

/** The parent table each `attachableType` points at. */
const PARENT_TABLES = {
	event_listing: eventListing,
	group,
	user,
	// `satisfies Record<AttachableType, …>` is what makes this exhaustive: adding
	// a value to `attachableTypes` fails to compile until the sweep is told which
	// table to check it against. Without that, a new type's attachments would
	// simply never be reaped and the objects would leak.
	inventory_item: inventoryItem,
	inventory_asset: inventoryAsset,
	work_request: workRequest,
	acquisition,
	// Cover art only. A release's recordings are in the private bucket and are
	// not `media` rows, so this pass reaps the cover of a deleted release and
	// has nothing to say about the audio — which `audio_track` deletes outright,
	// having no sibling usages to count.
	audio_release: audioRelease
} as const satisfies Record<AttachableType, unknown>;

export type SweepResult = {
	/** Attachment rows whose parent no longer existed. */
	orphanedAttachments: number;
	/** Objects deleted from R2, with their `media` row. */
	reapedMedia: number;
	/**
	 * Objects R2 refused to delete. Their rows are deliberately kept so the next
	 * run retries — dropping the row would strand the object with no record of
	 * its key, which is the `band_media` failure this whole design exists to
	 * avoid.
	 */
	failedDeletes: number;
};

/**
 * Pass 1 — drop attachments whose parent is gone.
 *
 * One statement per `attachableType` rather than one clever query: the types
 * point at different tables, so a single statement would need a UNION per arm
 * anyway, and a per-type `DELETE ... WHERE NOT EXISTS` is what SQLite can
 * actually use the `(attachable_type, attachable_id, slot)` index for.
 */
async function reapOrphanedAttachments(): Promise<number> {
	let deleted = 0;

	for (const type of attachableTypes) {
		const parent = PARENT_TABLES[type] as { id: SQLWrapper };
		const rows = await db
			.delete(mediaAttachment)
			.where(
				and(
					eq(mediaAttachment.attachableType, type),
					notExists(
						db
							.select({ one: sql`1` })
							.from(parent as never)
							.where(eq(parent.id as never, mediaAttachment.attachableId))
					)
				)
			)
			.returning({ id: mediaAttachment.id });
		deleted += rows.length;
	}

	return deleted;
}

/**
 * Pass 2 — delete the object, then its row, for every `media` nothing points at.
 *
 * **The object goes first, always.** The row is the only record of the key, so
 * deleting the row first and then failing to delete the object leaves an
 * unreachable file billed forever. Doing it in this order means the worst case
 * is an object deleted whose row survives to the next run, which that run then
 * finds already gone and removes — recoverable in a way the other order is not.
 */
async function reapUnreferencedMedia(now: Date): Promise<{ reaped: number; failed: number }> {
	const cutoff = new Date(now.getTime() - MEDIA_SWEEP_GRACE_MS);

	const candidates = await db
		.select({ id: media.id, key: media.key })
		.from(media)
		.where(
			and(
				lt(media.createdAt, cutoff),
				notExists(
					db
						.select({ one: sql`1` })
						.from(mediaAttachment)
						.where(eq(mediaAttachment.mediaId, media.id))
				)
			)
		);

	const deletedIds: string[] = [];
	let failed = 0;

	for (const row of candidates) {
		try {
			await deleteObject(row.key);
			deletedIds.push(row.id);
		} catch (err) {
			// Keep the row. Losing the key is the one unrecoverable outcome here.
			console.error(`[sweep-media] failed to delete ${row.key}:`, err);
			failed++;
		}
	}

	// Chunked: D1 caps a statement at 100 bound parameters, and this list is
	// unbounded by anything but how much was abandoned since the last run.
	const CHUNK = 90;
	for (let i = 0; i < deletedIds.length; i += CHUNK) {
		await db.delete(media).where(inArray(media.id, deletedIds.slice(i, i + CHUNK)));
	}

	return { reaped: deletedIds.length, failed };
}

/**
 * Run both passes, in order. Pass 1 must precede pass 2: an attachment orphaned
 * by a deleted parent is exactly what makes its media row unreferenced, so
 * running them the other way round would leave every such object waiting a full
 * extra cycle.
 */
export async function sweepMedia(now: Date = new Date()): Promise<SweepResult> {
	const orphanedAttachments = await reapOrphanedAttachments();
	const { reaped, failed } = await reapUnreferencedMedia(now);

	return {
		orphanedAttachments,
		reapedMedia: reaped,
		failedDeletes: failed
	};
}
