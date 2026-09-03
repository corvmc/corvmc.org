import { deletePrivateObject } from '$lib/server/private-storage';
import { deleteRows, listSweepCandidates } from './file-service';
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
 * The candidate logic differs in kind as well: there is no attachment
 * indirection here and no reference counting, just rows their group already
 * asked to be rid of.
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
};

export async function sweepGroupFiles(now: Date = new Date()): Promise<FileSweepResult> {
	const cutoff = new Date(now.getTime() - DOCUMENT_SWEEP_GRACE_MS);
	const candidates = await listSweepCandidates(cutoff);

	const deletedIds: string[] = [];
	let failed = 0;

	// **The object goes first, always.** The row is the only record of the key,
	// so deleting the row and then failing to delete the object leaves an
	// unreachable file billed forever. This order's worst case is an object
	// deleted whose row survives to the next run, which finds the key already
	// gone — a no-op success — and removes it. Recoverable in a way the other
	// order is not.
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

	return { reapedFiles: deletedIds.length, failedFileDeletes: failed };
}
