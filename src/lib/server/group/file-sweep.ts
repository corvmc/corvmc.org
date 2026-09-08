import { deletePrivateObject, listPrivateObjects } from '$lib/server/private-storage';
import { deleteRows, listExistingKeys, listSweepCandidates } from './file-service';
import { DOCUMENT_KEY_PREFIX, isDocumentKey } from '$lib/server/storage-keys';
import { DOCUMENT_SWEEP_GRACE_MS } from '$lib/config';

/**
 * The reaper for group documents, behind the same rule `media-sweep-service.ts`
 * runs on:
 *
 *   An R2 object is never deleted as a side effect of deleting a row.
 *
 * Removing a document sets `deletedAt` and stops there. This job is the one
 * place that turns that into a deleted object, and being a single writer on a
 * daily schedule is what lets it decide safely on a database with no usable
 * transaction.
 *
 * **A separate module from `media-sweep-service.ts`, not a third pass inside
 * it.** That module imports `deleteObject` from `storage.ts` — the *public*
 * bucket's deleter. Putting a private-bucket deleter a few lines away from it,
 * with `key` variables of identical type and nothing distinguishing them,
 * recreates exactly the adjacency the two storage modules were split to prevent.
 *
 * Two passes, and they answer opposite questions. The row pass starts from rows
 * and reaps their objects; the orphan pass starts from objects and reaps the
 * ones no row claims. Neither can see what the other sees: a row whose object
 * was already deleted is invisible to a bucket listing, and an object whose row
 * the `group` cascade took is invisible to every query in `file-service.ts`.
 */

export type FileSweepResult = {
	/** Objects deleted from the private bucket, with their `file` row. */
	reapedFiles: number;
	/**
	 * Objects R2 refused to delete. Their rows are deliberately kept so the next
	 * run retries — dropping the row would strand the object with no record of
	 * its key.
	 */
	failedFileDeletes: number;
	/** Objects deleted because no `file` row, live or soft-deleted, named them. */
	reapedOrphanObjects: number;
	/**
	 * Objects the orphan pass declined to judge: inside the grace window, not
	 * shaped like a document key, or past this run's delete budget. Reported
	 * rather than silently dropped — an orphan left behind costs storage, and
	 * that is the cheap half of this trade.
	 */
	skippedOrphanObjects: number;
	/** Orphans R2 refused to delete. The next run finds them again. */
	failedOrphanDeletes: number;
	/** Objects remained beyond `MAX_ORPHAN_PAGES`. The next run starts over and reaches no further. */
	orphanScanTruncated: boolean;
};

/**
 * One run walks at most this many pages of 1000 keys, and deletes at most this
 * many objects. Both are budgets rather than correctness bounds: whatever is
 * left is reported and swept the next day. The delete cap is the blast radius a
 * wrong answer from `listExistingKeys` could have.
 */
const MAX_ORPHAN_PAGES = 10;
const MAX_ORPHAN_DELETES = 500;

/**
 * Pass A — the rows a group already asked to be rid of.
 *
 * **The object goes first, always.** The row is the only record of the key, so
 * deleting the row and then failing to delete the object leaves an unreachable
 * file billed forever. This order's worst case is an object deleted whose row
 * survives to the next run, which finds the key already gone — a no-op success
 * — and removes it. Recoverable in a way the other order is not.
 */
async function reapSoftDeletedRows(cutoff: Date): Promise<{ reaped: number; failed: number }> {
	const candidates = await listSweepCandidates(cutoff);

	const deletedIds: string[] = [];
	let failed = 0;

	for (const row of candidates) {
		try {
			await deletePrivateObject(row.key);
			deletedIds.push(row.id);
		} catch (err) {
			console.error(`[sweep-files] failed to delete ${row.key}:`, err);
			failed++;
		}
	}

	await deleteRows(deletedIds);

	return { reaped: deletedIds.length, failed };
}

/**
 * Pass B — the objects no row names at all.
 *
 * `file.groupId` cascades, so deleting a group takes its rows and leaves their
 * objects addressed by nothing. `deleteBand` purges first to avoid that, but
 * that is one caller's discipline standing in for a guarantee; this pass is the
 * guarantee. It is not pass A repeated: a soft-deleted row still answers
 * "present" here, so a document inside its undo week is never reaped early.
 *
 * Conservative in one direction only. An object is deleted solely on a positive
 * "no row exists" from `listExistingKeys` over a recognised key past the grace
 * window; everything else is counted into `skippedOrphanObjects` and left alone.
 */
async function reapOrphanedObjects(
	cutoff: Date
): Promise<{ reaped: number; skipped: number; failed: number; truncated: boolean }> {
	let reaped = 0;
	let skipped = 0;
	let failed = 0;
	let cursor: string | undefined;
	let page = 0;

	do {
		const listed = await listPrivateObjects(DOCUMENT_KEY_PREFIX, cursor);
		cursor = listed.cursor;
		page++;

		// A key this module does not recognise belongs to another consumer of the
		// bucket, which has no `file` row to be missing from. The grace window
		// covers the gap between writing an object and its row being visible.
		const candidates: string[] = [];
		for (const object of listed.objects) {
			if (isDocumentKey(object.key) && object.uploaded < cutoff) candidates.push(object.key);
			else skipped++;
		}

		const present = await listExistingKeys(candidates);

		for (const key of candidates) {
			if (present.has(key)) continue;
			if (reaped + failed >= MAX_ORPHAN_DELETES) {
				skipped++;
				continue;
			}
			try {
				await deletePrivateObject(key);
				reaped++;
			} catch (err) {
				console.error(`[sweep-files] failed to delete orphan ${key}:`, err);
				failed++;
			}
		}
	} while (cursor && page < MAX_ORPHAN_PAGES);

	return { reaped, skipped, failed, truncated: Boolean(cursor) };
}

/**
 * Both passes, in order. Pass A must precede pass B: it deletes rows, and an
 * object whose row it is about to remove would otherwise be judged rowless by a
 * listing taken first — reaped by the pass that owes it no grace window.
 */
export async function sweepGroupFiles(now: Date = new Date()): Promise<FileSweepResult> {
	const cutoff = new Date(now.getTime() - DOCUMENT_SWEEP_GRACE_MS);

	const rows = await reapSoftDeletedRows(cutoff);
	const orphans = await reapOrphanedObjects(cutoff);

	return {
		reapedFiles: rows.reaped,
		failedFileDeletes: rows.failed,
		reapedOrphanObjects: orphans.reaped,
		skippedOrphanObjects: orphans.skipped,
		failedOrphanDeletes: orphans.failed,
		orphanScanTruncated: orphans.truncated
	};
}
