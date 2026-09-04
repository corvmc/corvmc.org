import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The parts of the service worth pinning without a database: the track
 * numbering, the publish preconditions, and the price rule.
 *
 * `(release_id, track_number)` is UNIQUE, so both the delete-and-close-the-gap
 * and the reorder are constrained sequences rather than loops — get either
 * ordering wrong and the statement fails on a conflict against a row that is
 * about to move. That is the property these assert, since a real D1 is not
 * available here and `better-sqlite3` is not built in CI.
 */

type Row = Record<string, unknown>;

/**
 * A small drizzle stand-in that records what was asked of it.
 *
 * Only the call shapes this service uses are modelled — `select().from().where()`,
 * `update().set().where()`, `delete().where()`, `insert().values().returning()`
 * and `batch()`. It returns whatever `nextResults` holds, in order.
 */
const state = {
	results: [] as unknown[][],
	updates: [] as { set: Row; where: string }[],
	deletes: [] as string[],
	batches: [] as number[]
};

function queue(...results: unknown[][]) {
	state.results = results;
}

function chain(rows: unknown[]) {
	const self: Record<string, unknown> = {};
	for (const key of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin']) {
		self[key] = () => self;
	}
	// Awaiting the builder is what runs it — the same shape drizzle has.
	self.then = (resolve: (v: unknown) => void) => resolve(rows);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(state.results.shift() ?? []),
		update: () => ({
			set: (values: Row) => ({
				where: (w: unknown) => {
					state.updates.push({ set: values, where: String(w) });
					// One shift per statement, taken lazily. An eager
					// `Object.assign(Promise.resolve(shift()), { returning })` consumes
					// two entries for one update — the awaited value and the
					// `.returning()` value — and every later expectation in the file
					// then reads somebody else's row.
					let rows: unknown[] | null = null;
					const take = () => (rows ??= state.results.shift() ?? []);
					return {
						returning: () => Promise.resolve(take()),
						then: (resolve: (v: unknown) => void) => resolve(take())
					};
				}
			})
		}),
		delete: () => ({
			where: (w: unknown) => {
				state.deletes.push(String(w));
				return Promise.resolve([]);
			}
		}),
		insert: () => ({
			values: (v: Row) => ({ returning: () => Promise.resolve([{ id: 'new', ...v }]) })
		}),
		batch: (statements: unknown[]) => {
			state.batches.push(statements.length);
			return Promise.resolve([]);
		}
	}
}));

// Every `where(...)` above stringifies its argument, so the operators have to
// produce something readable rather than `[object Object]`.
vi.mock('drizzle-orm', () => ({
	and: (...parts: unknown[]) => `and(${parts.join(',')})`,
	asc: (c: unknown) => `asc(${String(c)})`,
	desc: (c: unknown) => `desc(${String(c)})`,
	eq: (a: unknown, b: unknown) => `eq(${String(a)},${String(b)})`,
	inArray: (a: unknown, b: unknown) => `inArray(${String(a)},${String(b)})`,
	isNull: (a: unknown) => `isNull(${String(a)})`,
	count: () => 'count()',
	max: (c: unknown) => `max(${String(c)})`,
	sql: Object.assign(
		(strings: TemplateStringsArray, ...values: unknown[]) =>
			strings.raw.join('?') + values.map(String).join(''),
		{ raw: (s: string) => s }
	)
}));

const deleteAudioObject = vi.fn(async () => undefined);
vi.mock('./audio-storage', () => ({ deleteAudioObject }));

const detachSlot = vi.fn(async () => undefined);
vi.mock('$lib/server/media/media-service', () => ({ detachSlot }));

vi.mock('$lib/server/storage', () => ({ resolveImageUrl: () => null }));

// Hoisted to module scope: an in-test `await import` on a cold Vite cache is
// what a "timed out in 5000ms" failure in this project usually is.
const service = await import('./audio-service');

beforeEach(() => {
	vi.clearAllMocks();
	state.results = [];
	state.updates = [];
	state.deletes = [];
	state.batches = [];
});

describe('nextTrackNumber', () => {
	it('starts an empty release at 1', async () => {
		queue([{ highest: null }]);
		expect(await service.nextTrackNumber('rel-1')).toBe(1);
	});

	it('continues after the highest existing number', async () => {
		queue([{ highest: 4 }]);
		expect(await service.nextTrackNumber('rel-1')).toBe(5);
	});
});

describe('deleteTrack', () => {
	it('deletes the object before the row', async () => {
		queue(
			// getTrackWithRelease
			[{ track: { id: 't2', releaseId: 'rel-1', objectKey: 'bands/audio/t2.wav' }, release: {} }],
			// remaining tracks, already contiguous
			[{ id: 't1', trackNumber: 1 }]
		);
		await service.deleteTrack('t2');

		// The row is the only record of the key. Dropping it first and then
		// failing on R2 strands a file that is billed forever with nothing left
		// pointing at it — the ordering the media sweep uses, for the same reason.
		expect(deleteAudioObject).toHaveBeenCalledWith('bands/audio/t2.wav');
		expect(state.deletes.length).toBe(1);
	});

	it('closes the gap so the next upload does not land on a used number', async () => {
		queue(
			[{ track: { id: 't2', releaseId: 'rel-1', objectKey: 'k' }, release: {} }],
			// 1 and 3 survive: 3 has to become 2, or `nextTrackNumber` returns 4 and
			// the fourth track of a three-track record is numbered 4.
			[
				{ id: 't1', trackNumber: 1 },
				{ id: 't3', trackNumber: 3 }
			]
		);
		await service.deleteTrack('t2');

		expect(state.updates).toHaveLength(1);
		expect(state.updates[0].set).toEqual({ trackNumber: 2 });
	});

	it('renumbers nothing when the tracks are already contiguous', async () => {
		queue(
			[{ track: { id: 't3', releaseId: 'rel-1', objectKey: 'k' }, release: {} }],
			[
				{ id: 't1', trackNumber: 1 },
				{ id: 't2', trackNumber: 2 }
			]
		);
		await service.deleteTrack('t3');
		expect(state.updates).toHaveLength(0);
	});

	it('refuses a track that does not exist', async () => {
		queue([]);
		await expect(service.deleteTrack('nope')).rejects.toThrow(/not found/i);
		expect(deleteAudioObject).not.toHaveBeenCalled();
	});
});

describe('reorderTracks', () => {
	it('vacates the number range before claiming it', async () => {
		queue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
		await service.reorderTracks('rel-1', ['c', 'a', 'b']);

		// Two batches, not one. `(release_id, track_number)` is unique, so any
		// permutation that swaps two rows collides partway through a single pass —
		// moving 1→2 while 2 is still 2 fails. Parking every row at a negative
		// number first vacates the whole range.
		expect(state.batches).toEqual([3, 3]);
	});

	it('keeps a track the client did not mention instead of dropping it', async () => {
		// A page loaded before a sibling uploaded track `d` would post three ids.
		// Ignoring `d` would leave it outside the sequence; the service appends it.
		queue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
		await service.reorderTracks('rel-1', ['c', 'a', 'b']);
		expect(state.batches).toEqual([4, 4]);
	});

	it('ignores an id belonging to another release', async () => {
		queue([{ id: 'a' }, { id: 'b' }]);
		await service.reorderTracks('rel-1', ['a', 'b', 'someone-elses-track']);
		expect(state.batches).toEqual([2, 2]);
	});
});

describe('publishRelease', () => {
	it('refuses a release with no tracks', async () => {
		queue([{ id: 'rel-1', status: 'draft', publishedAt: null }], [{ value: 0 }]);
		await expect(service.publishRelease('rel-1')).rejects.toThrow(/at least one track/i);
	});

	it('refuses to republish a withheld release', async () => {
		// A takedown is not a draft. Letting Publish undo it would make the
		// moderation action advisory.
		queue([{ id: 'rel-1', status: 'withheld', publishedAt: null }]);
		await expect(service.publishRelease('rel-1')).rejects.toThrow(/withheld/i);
	});

	it('keeps the original publishedAt when a pulled release goes back up', async () => {
		const first = new Date('2026-01-05T12:00:00Z');
		queue(
			[{ id: 'rel-1', status: 'draft', publishedAt: first }],
			[{ value: 3 }],
			[{ id: 'rel-1' }]
		);
		await service.publishRelease('rel-1');

		// The discography orders by this, so re-publishing must not shuffle an old
		// record to the top.
		expect(state.updates[0].set).toMatchObject({ status: 'published', publishedAt: first });
	});

	it('stamps publishedAt on a first publish', async () => {
		queue([{ id: 'rel-1', status: 'draft', publishedAt: null }], [{ value: 1 }], [{ id: 'rel-1' }]);
		await service.publishRelease('rel-1');
		expect(state.updates[0].set.publishedAt).toBeInstanceOf(Date);
	});
});

describe('unpublishRelease', () => {
	it('refuses to touch a withheld release', async () => {
		queue([{ id: 'rel-1', status: 'withheld' }]);
		await expect(service.unpublishRelease('rel-1')).rejects.toThrow(/withheld/i);
	});
});

describe('updateRelease — price', () => {
	it('accepts free', async () => {
		queue(
			[{ id: 'rel-1', status: 'draft', title: 'A', slug: 'a', groupId: 'g' }],
			[{ id: 'rel-1' }]
		);
		await expect(service.updateRelease('rel-1', { priceMinCents: 0 })).resolves.toBeDefined();
	});

	it('rejects the dead zone between free and the charge floor', async () => {
		// Stripe's own minimum is 50¢ and its fixed fee is 30¢, so these are the
		// prices where almost nothing reaches the band.
		for (const cents of [1, 49, 99, 199]) {
			queue([{ id: 'rel-1', status: 'draft', title: 'A', slug: 'a', groupId: 'g' }]);
			await expect(service.updateRelease('rel-1', { priceMinCents: cents })).rejects.toThrow(
				/free, or at least/i
			);
		}
	});

	it('accepts the floor itself', async () => {
		queue(
			[{ id: 'rel-1', status: 'draft', title: 'A', slug: 'a', groupId: 'g' }],
			[{ id: 'rel-1' }]
		);
		await expect(service.updateRelease('rel-1', { priceMinCents: 200 })).resolves.toBeDefined();
	});
});

describe('updateRelease — slug', () => {
	it('follows the title while the release is still a draft', async () => {
		queue(
			[{ id: 'rel-1', status: 'draft', title: 'Old', slug: 'old', groupId: 'g' }],
			// uniqueSlug's read of taken slugs
			[{ slug: 'old', id: 'rel-1' }],
			[{ id: 'rel-1' }]
		);
		await service.updateRelease('rel-1', { title: 'Marys Peak' });
		expect(state.updates[0].set.slug).toBe('marys-peak');
	});

	it('freezes the slug once published, so existing links keep working', async () => {
		queue(
			[{ id: 'rel-1', status: 'published', title: 'Old', slug: 'old', groupId: 'g' }],
			[{ id: 'rel-1' }]
		);
		await service.updateRelease('rel-1', { title: 'Marys Peak' });
		// A published record's address is on flyers and in purchase emails.
		expect(state.updates[0].set.slug).toBe('old');
	});
});

describe('deleteRelease', () => {
	it('archives rather than deletes when somebody has bought it', async () => {
		queue([{ id: 'rel-1', groupId: 'g' }], [{ value: 2 }], [{ id: 'rel-1' }]);
		expect(await service.deleteRelease('rel-1')).toBe('archived');

		// A band must not be able to reach into a buyer's library and empty it.
		expect(deleteAudioObject).not.toHaveBeenCalled();
		expect(state.deletes).toHaveLength(0);
		expect(state.updates[0].set).toMatchObject({ status: 'draft' });
		expect(state.updates[0].set.deletedAt).toBeInstanceOf(Date);
	});

	it('really deletes an unsold release, objects first', async () => {
		queue(
			[{ id: 'rel-1', groupId: 'g' }],
			[{ value: 0 }],
			[{ objectKey: 'bands/audio/a.wav' }, { objectKey: 'bands/audio/b.wav' }]
		);
		expect(await service.deleteRelease('rel-1')).toBe('deleted');

		expect(deleteAudioObject).toHaveBeenCalledTimes(2);
		// The cover is a shared-by-design `media` row: detached, never deleted, so
		// the sweep decides whether the object survives.
		expect(detachSlot).toHaveBeenCalledWith('audio_release', 'rel-1', 'cover');
		expect(state.deletes).toHaveLength(1);
	});
});
