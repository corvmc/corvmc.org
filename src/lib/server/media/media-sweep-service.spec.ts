import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachableTypes } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks
//
// Only `$lib/server/db` and `$lib/server/storage` are mocked, so the drizzle
// operators are real and the order of R2 deletes versus row deletes — the part
// that is load-bearing — is directly observable.
// ---------------------------------------------------------------------------

/** Rows the next `db.select()` should resolve to. */
let mediaCandidates: { id: string; key: string }[] = [];
/** Rows each `db.delete().returning()` should claim to have removed. */
let attachmentDeleteReturns: { id: string }[][] = [];

/** Everything that happened, in order, so sequencing can be asserted. */
let journal: string[] = [];
const deletedRowIds: string[][] = [];

function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

function selectChain(result: unknown[]) {
	const chain: Record<string, unknown> = {};
	const step = () => () => chain;
	Object.assign(chain, {
		from: step(),
		innerJoin: step(),
		where: step(),
		orderBy: step(),
		// A subquery is awaited by drizzle only when used as a value; as a
		// `notExists(...)` operand it is inspected, not resolved.
		then: (resolve: (v: unknown[]) => void) => resolve(result)
	});
	return chain;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => selectChain(mediaCandidates)),
		delete: vi.fn((table: unknown) => ({
			where: vi.fn((_w: unknown) => {
				const name = tableName(table);
				const chain = {
					returning: vi.fn(() => {
						journal.push(`delete:${name}`);
						return Promise.resolve(attachmentDeleteReturns.shift() ?? []);
					}),
					then: (resolve: (v: unknown) => void) => {
						journal.push(`delete:${name}`);
						return resolve(undefined);
					}
				};
				return chain;
			})
		}))
	}
}));

const deleteObjectMock = vi.fn(async (key: string) => {
	journal.push(`r2:${key}`);
});

vi.mock('$lib/server/storage', () => ({
	deleteObject: (key: string) => deleteObjectMock(key)
}));

const { sweepMedia } = await import('./media-sweep-service');
const { MEDIA_SWEEP_GRACE_MS } = await import('$lib/config');

const NOW = new Date('2026-08-28T00:00:00Z');

beforeEach(() => {
	mediaCandidates = [];
	attachmentDeleteReturns = [];
	journal = [];
	deletedRowIds.length = 0;
	deleteObjectMock.mockReset();
	deleteObjectMock.mockImplementation(async (key: string) => {
		journal.push(`r2:${key}`);
	});
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe('sweepMedia — orphaned attachments', () => {
	it('reaps one statement per attachable type', async () => {
		// Counted off `attachableTypes` rather than hardcoded: a type with no arm
		// would leave its orphans forever, and that is the failure this pins —
		// not the number, which moves every time the vocabulary grows.
		attachmentDeleteReturns = attachableTypes.map((_, i) => (i === 0 ? [{ id: 'a1' }] : []));
		attachmentDeleteReturns[attachableTypes.length - 1] = [{ id: 'a2' }];

		const result = await sweepMedia(NOW);

		expect(journal.filter((j) => j === 'delete:media_attachment')).toHaveLength(
			attachableTypes.length
		);
		expect(result.orphanedAttachments).toBe(2);
	});

	it('runs before the media pass, so a freed object is reaped the same cycle', async () => {
		// The other order leaves every object freed by a deleted parent waiting a
		// full extra cycle before anything notices it is unreferenced.
		mediaCandidates = [{ id: 'm1', key: 'k1' }];
		attachmentDeleteReturns = [[{ id: 'a1' }], [], []];

		await sweepMedia(NOW);

		expect(journal.indexOf('delete:media_attachment')).toBeLessThan(journal.indexOf('r2:k1'));
	});
});

describe('sweepMedia — unreferenced media', () => {
	it('deletes the R2 object BEFORE the row that records its key', async () => {
		// The row is the only handle on the object. Dropping it first and then
		// failing the R2 delete strands the file forever — the `band_media`
		// failure this whole design exists to avoid.
		mediaCandidates = [{ id: 'm1', key: 'posters/abc.jpg' }];

		await sweepMedia(NOW);

		expect(journal.indexOf('r2:posters/abc.jpg')).toBeLessThan(journal.indexOf('delete:media'));
	});

	it('keeps the row when R2 refuses, so the next run retries', async () => {
		mediaCandidates = [{ id: 'm1', key: 'k1' }];
		deleteObjectMock.mockRejectedValueOnce(new Error('R2 down'));

		const result = await sweepMedia(NOW);

		expect(result.failedDeletes).toBe(1);
		expect(result.reapedMedia).toBe(0);
		expect(journal).not.toContain('delete:media');
	});

	it('reaps the objects it could delete even when a sibling fails', async () => {
		mediaCandidates = [
			{ id: 'm1', key: 'k1' },
			{ id: 'm2', key: 'k2' }
		];
		deleteObjectMock.mockRejectedValueOnce(new Error('R2 down'));

		const result = await sweepMedia(NOW);

		expect(result.failedDeletes).toBe(1);
		expect(result.reapedMedia).toBe(1);
	});

	it('deletes no row at all when there is nothing to reap', async () => {
		mediaCandidates = [];

		const result = await sweepMedia(NOW);

		expect(result.reapedMedia).toBe(0);
		expect(deleteObjectMock).not.toHaveBeenCalled();
		expect(journal).not.toContain('delete:media');
	});

	it('chunks the row delete under D1’s 100-parameter statement cap', async () => {
		mediaCandidates = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, key: `k${i}` }));

		await sweepMedia(NOW);

		// 200 ids at 90 per statement is three, not one oversized statement that
		// D1 would reject outright.
		expect(journal.filter((j) => j === 'delete:media')).toHaveLength(3);
	});
});

describe('sweepMedia — the grace window', () => {
	it('is a real window, not zero', async () => {
		// A zero window would delete an object between the upload and the attach,
		// which are two separate steps with a human in between.
		expect(MEDIA_SWEEP_GRACE_MS).toBeGreaterThan(60_000);
	});
});
