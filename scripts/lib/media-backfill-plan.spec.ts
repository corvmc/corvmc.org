import { describe, expect, it } from 'vitest';
import {
	SLOT_FOR_BAND_MEDIA,
	attachmentFingerprint,
	isR2Key,
	planBackfill,
	type ObjectMeta,
	type Source
} from './media-backfill-plan';

let n = 0;
const ids = () => `id-${++n}`;
const resetIds = () => (n = 0);

function source(over: Partial<Source> = {}): Source {
	return {
		key: 'events/posters/a.jpg',
		attachableType: 'event',
		attachableId: 'event-1',
		slot: 'poster',
		sortOrder: 0,
		label: 'test',
		...over
	};
}

const META: ObjectMeta = { contentType: 'image/jpeg', byteSize: 1234 };
const metaFor = (...keys: string[]) => new Map(keys.map((k) => [k, META]));

describe('isR2Key', () => {
	it('accepts a key', () => {
		expect(isR2Key('users/avatars/abc.jpg')).toBe(true);
	});

	it('rejects an OAuth avatar URL', () => {
		// better-auth owns `user.image` and may put a provider URL there. Recording
		// it would invent a key naming no object in this bucket.
		expect(isR2Key('https://lh3.googleusercontent.com/a/abc')).toBe(false);
		expect(isR2Key('http://example.com/a.png')).toBe(false);
		expect(isR2Key('HTTPS://EXAMPLE.COM/a.png')).toBe(false);
	});

	it('rejects empty and absent values', () => {
		expect(isR2Key('')).toBe(false);
		expect(isR2Key(null)).toBe(false);
		expect(isR2Key(undefined)).toBe(false);
	});
});

describe('SLOT_FOR_BAND_MEDIA', () => {
	it('maps every type band_media actually stores', () => {
		// The column is a bare string with this comment as its only contract:
		// 'image' | 'hero' | 'rider' | 'stage_plot'.
		expect(Object.keys(SLOT_FOR_BAND_MEDIA).toSorted()).toEqual([
			'hero',
			'image',
			'rider',
			'stage_plot'
		]);
	});

	it("renames only the one whose name differs, 'image' to 'gallery'", () => {
		expect(SLOT_FOR_BAND_MEDIA.image).toBe('gallery');
		expect(SLOT_FOR_BAND_MEDIA.hero).toBe('hero');
	});
});

describe('planBackfill', () => {
	it('gives one media row to a key used by several parents', () => {
		resetIds();
		const plan = planBackfill(
			[
				source({ attachableId: 'event-1' }),
				source({ attachableId: 'event-2' }),
				source({ attachableId: 'event-3' })
			],
			new Map(),
			new Set(),
			metaFor('events/posters/a.jpg'),
			ids
		);

		// The whole point of the split: 52 occurrences of a series, one object.
		expect(plan.media).toHaveLength(1);
		expect(plan.attachments).toHaveLength(3);
		expect(new Set(plan.attachments.map((a) => a.mediaId)).size).toBe(1);
	});

	it('carries the size and type read from R2 onto the row', () => {
		resetIds();
		const plan = planBackfill(
			[source()],
			new Map(),
			new Set(),
			metaFor('events/posters/a.jpg'),
			ids
		);
		expect(plan.media[0]).toMatchObject({ contentType: 'image/jpeg', byteSize: 1234 });
	});

	it('inserts nothing at all for a key whose object is gone', () => {
		resetIds();
		const plan = planBackfill([source()], new Map(), new Set(), new Map(), ids);

		// Not even the media row. A fabricated size would be worse than no row:
		// something would point at it, so the sweep would keep it forever while it
		// names nothing.
		expect(plan.media).toHaveLength(0);
		expect(plan.attachments).toHaveLength(0);
		expect(plan.missing).toHaveLength(1);
	});

	it('still records the sound keys when one of them is missing', () => {
		resetIds();
		const plan = planBackfill(
			[source({ key: 'good.jpg' }), source({ key: 'gone.jpg', attachableId: 'event-2' })],
			new Map(),
			new Set(),
			metaFor('good.jpg'),
			ids
		);
		expect(plan.media.map((m) => m.key)).toEqual(['good.jpg']);
		expect(plan.attachments).toHaveLength(1);
		expect(plan.missing).toHaveLength(1);
	});

	it('reuses a media row an earlier run already inserted', () => {
		resetIds();
		const plan = planBackfill(
			[source()],
			new Map([['events/posters/a.jpg', 'media-existing']]),
			new Set(),
			metaFor('events/posters/a.jpg'),
			ids
		);

		expect(plan.media).toHaveLength(0);
		expect(plan.attachments[0].mediaId).toBe('media-existing');
	});

	it('is idempotent: a completed run plans nothing on a second pass', () => {
		resetIds();
		const first = planBackfill(
			[source(), source({ attachableId: 'event-2' })],
			new Map(),
			new Set(),
			metaFor('events/posters/a.jpg'),
			ids
		);

		const mediaByKey = new Map(first.media.map((m) => [m.key, m.id]));
		const attachments = new Set(
			first.attachments.map((a) =>
				attachmentFingerprint(a.mediaId, a.attachableType, a.attachableId, a.slot)
			)
		);

		const second = planBackfill(
			[source(), source({ attachableId: 'event-2' })],
			mediaByKey,
			attachments,
			metaFor('events/posters/a.jpg'),
			ids
		);

		expect(second.media).toHaveLength(0);
		expect(second.attachments).toHaveLength(0);
		expect(second.alreadyDone).toBe(2);
	});

	it('does not duplicate a usage repeated within one run', () => {
		resetIds();
		const plan = planBackfill(
			[source(), source()],
			new Map(),
			new Set(),
			metaFor('events/posters/a.jpg'),
			ids
		);
		expect(plan.attachments).toHaveLength(1);
		expect(plan.alreadyDone).toBe(1);
	});

	it('keeps one parent’s two slots apart', () => {
		resetIds();
		const plan = planBackfill(
			[
				source({ key: 'k.jpg', attachableType: 'group', attachableId: 'g1', slot: 'avatar' }),
				source({ key: 'k.jpg', attachableType: 'group', attachableId: 'g1', slot: 'hero' })
			],
			new Map(),
			new Set(),
			metaFor('k.jpg'),
			ids
		);

		// Same object, same parent, two distinct usages — the slot is what
		// separates them, so both belong.
		expect(plan.media).toHaveLength(1);
		expect(plan.attachments.map((a) => a.slot).toSorted()).toEqual(['avatar', 'hero']);
	});

	it('preserves sortOrder, which is the gallery’s ordering', () => {
		resetIds();
		const plan = planBackfill(
			[
				source({ key: 'a.jpg', slot: 'gallery', sortOrder: 2 }),
				source({ key: 'b.jpg', slot: 'gallery', sortOrder: 0, attachableId: 'event-2' })
			],
			new Map(),
			new Set(),
			metaFor('a.jpg', 'b.jpg'),
			ids
		);
		expect(plan.attachments.map((a) => a.sortOrder)).toEqual([2, 0]);
	});
});
