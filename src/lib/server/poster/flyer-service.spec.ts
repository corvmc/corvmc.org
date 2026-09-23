import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Where a rendered flyer goes. The rendering itself is `flyer.spec.ts`'s; here
 * it is stubbed so these read only what lands in the poster slot.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});
vi.mock('$lib/server/db', () => ({ db: testDb }));

const uploads: { key: string; type: string }[] = [];
const objects = new Map<string, Uint8Array>();
vi.mock('$lib/server/storage', () => ({
	uploadFile: async (_b: ArrayBuffer, key: string, type: string) => {
		uploads.push({ key, type });
		return key;
	},
	getObject: async (key: string) =>
		objects.has(key) ? { bytes: objects.get(key)!, contentType: 'image/png' } : null,
	resolveImageUrl: (key: string | null) => key
}));

const rendered: { title: string; withArt: boolean }[] = [];
vi.mock('./flyer', async (orig) => ({
	...(await orig<typeof import('./flyer')>()),
	renderFlyer: async (lines: { title: string }, art?: unknown) => {
		rendered.push({ title: lines.title, withArt: Boolean(art) });
		return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	}
}));

const { useTemplateFlyer, useArtWithFooter, FlyerEventNotFoundError } =
	await import('./flyer-service');
const { PosterRequestNotFoundError } =
	await import('$lib/server/production/artifact-request-service');

const EVENT = 'evt-1';
const ARTIST = 'entry-artist';

function posterAttachments() {
	return sqlite
		.prepare(
			`select m.key, m.alt_text as alt from media_attachment a join media m on m.id = a.media_id
			 where a.attachable_type = 'event_listing' and a.attachable_id = ? and a.slot = 'poster'`
		)
		.all(EVENT) as { key: string; alt: string | null }[];
}

beforeEach(() => {
	for (const t of [
		'media_attachment',
		'media',
		'artifact_request',
		'event_band',
		'directory_entry',
		'event_listing'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id)
		 values ('${EVENT}', 'Harvest Show', 1790000000, 1790010000, 'u-1')`
	);
	sqlite.exec(
		`insert into directory_entry (id, name, visibility) values ('${ARTIST}', 'Ada Ink', 'hidden')`
	);
	uploads.length = 0;
	rendered.length = 0;
	objects.clear();
});

describe('useTemplateFlyer', () => {
	it('renders the template and makes it the poster', async () => {
		await useTemplateFlyer(EVENT);

		expect(rendered).toEqual([{ title: 'Harvest Show', withArt: false }]);
		expect(uploads).toEqual([
			{ key: expect.stringMatching(/^events\/posters\/.*\.png$/), type: 'image/png' }
		]);
		expect(posterAttachments()).toEqual([{ key: uploads[0].key, alt: 'Flyer for Harvest Show' }]);
	});

	it('replaces a poster that was already there', async () => {
		await useTemplateFlyer(EVENT);
		await useTemplateFlyer(EVENT);
		expect(posterAttachments()).toHaveLength(1);
	});

	it('refuses an event that does not exist', async () => {
		await expect(useTemplateFlyer('nope')).rejects.toBeInstanceOf(FlyerEventNotFoundError);
		expect(uploads).toEqual([]);
	});
});

describe('useArtWithFooter', () => {
	async function delivered() {
		sqlite.exec(
			`insert into artifact_request (id, event_id, entry_id, artifact)
			 values ('req-1', '${EVENT}', '${ARTIST}', 'poster_art')`
		);
		sqlite.exec(
			`insert into media (id, key, content_type, byte_size) values ('med-1', 'acts/poster-art/a.png', 'image/png', 4)`
		);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('att-1', 'med-1', 'artifact_request', 'req-1', 'poster')`
		);
		objects.set('acts/poster-art/a.png', new Uint8Array([1, 2, 3]));
	}

	it("composites the artist's original, not the current poster", async () => {
		await delivered();
		await useArtWithFooter('req-1');

		expect(rendered).toEqual([{ title: 'Harvest Show', withArt: true }]);
		expect(posterAttachments()).toEqual([
			{ key: expect.stringMatching(/^events\/posters\//), alt: 'Flyer for Harvest Show' }
		]);
	});

	it('refuses when no art has arrived', async () => {
		sqlite.exec(
			`insert into artifact_request (id, event_id, entry_id, artifact)
			 values ('req-1', '${EVENT}', '${ARTIST}', 'poster_art')`
		);
		await expect(useArtWithFooter('req-1')).rejects.toBeInstanceOf(PosterRequestNotFoundError);
	});

	it('refuses when the delivered object is missing from the bucket', async () => {
		await delivered();
		objects.clear();
		await expect(useArtWithFooter('req-1')).rejects.toBeInstanceOf(PosterRequestNotFoundError);
		expect(uploads).toEqual([]);
	});
});
