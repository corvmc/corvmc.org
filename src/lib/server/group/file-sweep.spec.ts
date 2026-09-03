import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DOCUMENT_SWEEP_GRACE_MS } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks
//
// `file-service` and `private-storage` are faked, so the one thing that is
// load-bearing — the order of the R2 delete against the row delete — is
// directly observable, and so is what the sweep does when R2 refuses.
// ---------------------------------------------------------------------------

let candidates: { id: string; key: string }[] = [];
let cutoffSeen: Date | null = null;
let journal: string[] = [];
let deletedRowIds: string[][] = [];

const deletePrivateObject = vi.fn(async (key: string) => {
	journal.push(`deleteObject:${key}`);
});

vi.mock('$lib/server/private-storage', () => ({
	deletePrivateObject: (key: string) => deletePrivateObject(key)
}));

vi.mock('./file-service', () => ({
	listSweepCandidates: async (cutoff: Date) => {
		cutoffSeen = cutoff;
		return candidates;
	},
	deleteRows: async (ids: string[]) => {
		journal.push(`deleteRows:${ids.join(',')}`);
		deletedRowIds.push(ids);
	}
}));

const { sweepGroupFiles } = await import('./file-sweep');

beforeEach(() => {
	vi.clearAllMocks();
	candidates = [];
	cutoffSeen = null;
	journal = [];
	deletedRowIds = [];
});

describe('sweepGroupFiles', () => {
	it('reaps candidates and reports the count', async () => {
		candidates = [
			{ id: 'f1', key: 'groups/g1/documents/f1.pdf' },
			{ id: 'f2', key: 'groups/g1/documents/f2.csv' }
		];

		const result = await sweepGroupFiles();

		expect(result).toEqual({ reapedFiles: 2, failedFileDeletes: 0 });
		expect(deletedRowIds).toEqual([['f1', 'f2']]);
	});

	/**
	 * The row is the only record of the key. Deleting it first and then failing
	 * to delete the object leaves an unreachable file billed forever; this order's
	 * worst case is an object gone whose row survives to the next run, which finds
	 * the key already absent — a no-op success — and removes it.
	 */
	it('deletes each object before any row', async () => {
		candidates = [{ id: 'f1', key: 'k1' }];

		await sweepGroupFiles();

		expect(journal).toEqual(['deleteObject:k1', 'deleteRows:f1']);
	});

	it('keeps the row when R2 refuses, so the next run retries', async () => {
		candidates = [
			{ id: 'f1', key: 'k1' },
			{ id: 'f2', key: 'k2' }
		];
		deletePrivateObject.mockRejectedValueOnce(new Error('R2 down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await sweepGroupFiles();

		expect(result).toEqual({ reapedFiles: 1, failedFileDeletes: 1 });
		// f1's row survives; f2's does not.
		expect(deletedRowIds).toEqual([['f2']]);
	});

	it('leaves rows inside the grace window alone', async () => {
		const now = new Date('2026-09-01T00:00:00Z');

		await sweepGroupFiles(now);

		// The cutoff is what the candidate query filters on — a week back, not the
		// media sweep's day.
		expect(cutoffSeen?.getTime()).toBe(now.getTime() - DOCUMENT_SWEEP_GRACE_MS);
	});

	it('does nothing when there is nothing to reap', async () => {
		const result = await sweepGroupFiles();

		expect(result).toEqual({ reapedFiles: 0, failedFileDeletes: 0 });
		expect(deletePrivateObject).not.toHaveBeenCalled();
	});
});
