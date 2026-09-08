import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DOCUMENT_SWEEP_GRACE_MS } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks
//
// `file-service` and `private-storage` are faked, so the two things that are
// load-bearing are directly observable: the order of the R2 delete against the
// row delete, and which objects the orphan pass is willing to condemn.
// `storage-keys` is NOT faked — `isDocumentKey` is the guard under test.
// ---------------------------------------------------------------------------

let candidates: { id: string; key: string }[] = [];
let cutoffSeen: Date | null = null;
let journal: string[] = [];
let deletedRowIds: string[][] = [];

/** Pages the bucket listing hands back, in order. */
let bucketPages: { objects: { key: string; uploaded: Date }[]; cursor: string | undefined }[] = [];
let listedPrefixes: string[] = [];
/** Keys the `file` table still has a row for. */
let existingKeys = new Set<string>();
let keysLookedUp: string[] = [];

const deletePrivateObject = vi.fn(async (key: string) => {
	journal.push(`deleteObject:${key}`);
});

vi.mock('$lib/server/private-storage', () => ({
	deletePrivateObject: (key: string) => deletePrivateObject(key),
	listPrivateObjects: async (prefix: string) => {
		listedPrefixes.push(prefix);
		journal.push('listObjects');
		return bucketPages.shift() ?? { objects: [], cursor: undefined };
	}
}));

vi.mock('./file-service', () => ({
	listSweepCandidates: async (cutoff: Date) => {
		cutoffSeen = cutoff;
		return candidates;
	},
	deleteRows: async (ids: string[]) => {
		journal.push(`deleteRows:${ids.join(',')}`);
		deletedRowIds.push(ids);
	},
	listExistingKeys: async (keys: string[]) => {
		keysLookedUp.push(...keys);
		return new Set([...keys].filter((key) => existingKeys.has(key)));
	}
}));

const { sweepGroupFiles } = await import('./file-sweep');

const OLD = new Date('2026-01-01T00:00:00Z');
const NOW = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
	vi.clearAllMocks();
	candidates = [];
	cutoffSeen = null;
	journal = [];
	deletedRowIds = [];
	bucketPages = [];
	listedPrefixes = [];
	existingKeys = new Set();
	keysLookedUp = [];
});

describe('sweepGroupFiles — the soft-deleted row pass', () => {
	it('reaps candidates and reports the count', async () => {
		candidates = [
			{ id: 'f1', key: 'groups/g1/documents/f1.pdf' },
			{ id: 'f2', key: 'groups/g1/documents/f2.csv' }
		];

		const result = await sweepGroupFiles();

		expect(result.reapedFiles).toBe(2);
		expect(result.failedFileDeletes).toBe(0);
		expect(deletedRowIds).toEqual([['f1', 'f2']]);
	});

	/**
	 * The row is the only record of the key. Deleting it first and then failing
	 * to delete the object leaves an unreachable file billed forever; this order's
	 * worst case is an object gone whose row survives to the next run.
	 */
	it('deletes each object before any row', async () => {
		candidates = [{ id: 'f1', key: 'k1' }];

		await sweepGroupFiles();

		expect(journal.slice(0, 2)).toEqual(['deleteObject:k1', 'deleteRows:f1']);
	});

	it('keeps the row when R2 refuses, so the next run retries', async () => {
		candidates = [
			{ id: 'f1', key: 'k1' },
			{ id: 'f2', key: 'k2' }
		];
		deletePrivateObject.mockRejectedValueOnce(new Error('R2 down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await sweepGroupFiles();

		expect(result.reapedFiles).toBe(1);
		expect(result.failedFileDeletes).toBe(1);
		// f1's row survives; f2's does not.
		expect(deletedRowIds).toEqual([['f2']]);
	});

	it('leaves rows inside the grace window alone', async () => {
		await sweepGroupFiles(NOW);

		// The cutoff is what the candidate query filters on — a week back, not the
		// media sweep's day.
		expect(cutoffSeen?.getTime()).toBe(NOW.getTime() - DOCUMENT_SWEEP_GRACE_MS);
	});

	it('does nothing when there is nothing to reap', async () => {
		const result = await sweepGroupFiles();

		expect(result.reapedFiles).toBe(0);
		expect(deletePrivateObject).not.toHaveBeenCalled();
	});
});

describe('sweepGroupFiles — the orphaned object pass', () => {
	/**
	 * `file.groupId` cascades, so a deleted group takes its rows and leaves the
	 * objects addressed by nothing. No query in `file-service.ts` can see them.
	 */
	it('reaps an object whose row is gone', async () => {
		bucketPages = [
			{ objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded: OLD }], cursor: undefined }
		];

		const result = await sweepGroupFiles(NOW);

		expect(deletePrivateObject).toHaveBeenCalledWith('groups/g1/documents/f1.pdf');
		expect(result.reapedOrphanObjects).toBe(1);
	});

	/** The unrecoverable direction. A live row's object must survive every sweep. */
	it('leaves an object whose row is live', async () => {
		bucketPages = [
			{ objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded: OLD }], cursor: undefined }
		];
		existingKeys = new Set(['groups/g1/documents/f1.pdf']);

		const result = await sweepGroupFiles(NOW);

		expect(deletePrivateObject).not.toHaveBeenCalled();
		expect(result.reapedOrphanObjects).toBe(0);
	});

	/**
	 * A soft-deleted row still answers "present", so the document keeps its undo
	 * week and is reaped by the row pass rather than early by this one.
	 */
	it('leaves an object whose row is only soft-deleted', async () => {
		bucketPages = [
			{ objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded: OLD }], cursor: undefined }
		];
		existingKeys = new Set(['groups/g1/documents/f1.pdf']);

		await sweepGroupFiles(NOW);

		expect(deletePrivateObject).not.toHaveBeenCalled();
	});

	it('skips an object still inside the grace window', async () => {
		const fresh = new Date(NOW.getTime() - 60 * 1000);
		bucketPages = [
			{ objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded: fresh }], cursor: undefined }
		];

		const result = await sweepGroupFiles(NOW);

		expect(deletePrivateObject).not.toHaveBeenCalled();
		expect(result.skippedOrphanObjects).toBe(1);
		// Never even asked about — the grace window decides before the row lookup.
		expect(keysLookedUp).toEqual([]);
	});

	/**
	 * Another consumer of this bucket has no `file` row to be missing from, so
	 * "no row" would condemn its objects wrongly.
	 */
	it('skips a key that is not shaped like a document key', async () => {
		bucketPages = [
			{
				objects: [
					{ key: 'groups/g1/invoices/x.pdf', uploaded: OLD },
					{ key: 'groups/g1/documents/nested/deep.pdf', uploaded: OLD }
				],
				cursor: undefined
			}
		];

		const result = await sweepGroupFiles(NOW);

		expect(deletePrivateObject).not.toHaveBeenCalled();
		expect(result.skippedOrphanObjects).toBe(2);
	});

	it('lists only the prefix group documents are written under', async () => {
		await sweepGroupFiles(NOW);

		expect(listedPrefixes).toEqual(['groups/']);
	});

	/**
	 * Pass A deletes rows. A listing taken first would find those objects rowless
	 * and reap them under a pass that owes them no grace window.
	 */
	it('runs the row pass before it lists the bucket', async () => {
		candidates = [{ id: 'f1', key: 'k1' }];

		await sweepGroupFiles(NOW);

		expect(journal).toEqual(['deleteObject:k1', 'deleteRows:f1', 'listObjects']);
	});

	it('follows the cursor across pages', async () => {
		bucketPages = [
			{ objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded: OLD }], cursor: 'next' },
			{ objects: [{ key: 'groups/g1/documents/f2.pdf', uploaded: OLD }], cursor: undefined }
		];

		const result = await sweepGroupFiles(NOW);

		expect(result.reapedOrphanObjects).toBe(2);
		expect(result.orphanScanTruncated).toBe(false);
	});

	it('stops at the page budget and says the scan was truncated', async () => {
		bucketPages = Array.from({ length: 12 }, () => ({
			objects: [{ key: 'groups/g1/documents/f.pdf', uploaded: OLD }],
			cursor: 'next' as string | undefined
		}));

		const result = await sweepGroupFiles(NOW);

		expect(listedPrefixes).toHaveLength(10);
		expect(result.orphanScanTruncated).toBe(true);
	});

	it('keeps the object when R2 refuses, and counts it as failed', async () => {
		bucketPages = [
			{ objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded: OLD }], cursor: undefined }
		];
		deletePrivateObject.mockRejectedValueOnce(new Error('R2 down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await sweepGroupFiles(NOW);

		expect(result.reapedOrphanObjects).toBe(0);
		expect(result.failedOrphanDeletes).toBe(1);
	});
});
