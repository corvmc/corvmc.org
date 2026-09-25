import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Recap photos against a real SQLite: the gate, the cap and the recaps strip
 * are all SQL predicates, which a mocked `db` would agree with unconditionally.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const uploadFile = vi.fn(async (_b: ArrayBuffer, key: string) => key);
vi.mock('$lib/server/storage', async (orig) => ({
	...(await orig<typeof import('$lib/server/storage')>()),
	uploadFile: (...a: Parameters<typeof uploadFile>) => uploadFile(...a),
	resolveImageUrl: (key: string | null | undefined) => (key ? `https://img/${key}` : null)
}));

const {
	addEventPhotos,
	removeEventPhoto,
	describeEventPhoto,
	listEventPhotos,
	listRecentRecaps,
	MAX_PHOTOS_PER_EVENT,
	RecapClosedError,
	RecapPhotoLimitError,
	RecapPhotoNotFoundError,
	RecapEventNotFoundError,
	setEventRecapText
} = await import('./event-photo-service');
const { eventListing } = await import('$lib/server/db/schema/event');

const NOW = new Date('2026-09-20T12:00:00Z');
const HOUR = 3600_000;

async function listing(id: string, over: Record<string, unknown> = {}) {
	await testDb.insert(eventListing).values({
		id,
		title: `Show ${id}`,
		startsAt: new Date(NOW.getTime() - 48 * HOUR),
		endsAt: new Date(NOW.getTime() - 45 * HOUR),
		createdByUserId: 'usr-1',
		status: 'published',
		source: 'cmc',
		kind: 'show',
		...over
	} as never);
}

function jpeg(name = 'a.jpg', size = 1024) {
	return new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
}

beforeEach(() => {
	uploadFile.mockClear();
	sqlite.exec('delete from media_attachment; delete from media; delete from event_listing;');
});

describe('addEventPhotos', () => {
	it('uploads each file and attaches it to the event gallery in order', async () => {
		await listing('e1');
		await addEventPhotos('e1', 'usr-1', [jpeg('one.jpg'), jpeg('two.jpg')], NOW);
		await addEventPhotos('e1', 'usr-1', [jpeg('three.jpg')], NOW);

		const photos = await listEventPhotos('e1');
		expect(photos.map((p) => p.filename)).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);
		expect(photos.every((p) => p.key.startsWith('events/photos/e1-'))).toBe(true);
		expect(photos[0].url).toBe(`https://img/${photos[0].key}`);
		expect(uploadFile).toHaveBeenCalledTimes(3);
	});

	it('refuses an event that has not started yet', async () => {
		await listing('e1', {
			startsAt: new Date(NOW.getTime() + HOUR),
			endsAt: new Date(NOW.getTime() + 3 * HOUR)
		});
		await expect(addEventPhotos('e1', 'usr-1', [jpeg()], NOW)).rejects.toBeInstanceOf(
			RecapClosedError
		);
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it('refuses a cancelled event', async () => {
		await listing('e1', { status: 'cancelled' });
		await expect(addEventPhotos('e1', 'usr-1', [jpeg()], NOW)).rejects.toBeInstanceOf(
			RecapClosedError
		);
	});

	it('refuses a file validateUpload rejects, before uploading any', async () => {
		await listing('e1');
		const gif = new File([new Uint8Array(10)], 'x.gif', { type: 'image/gif' });
		await expect(addEventPhotos('e1', 'usr-1', [jpeg(), gif], NOW)).rejects.toThrow(/not allowed/);
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it('caps an event at MAX_PHOTOS_PER_EVENT', async () => {
		await listing('e1');
		for (let i = 0; i < MAX_PHOTOS_PER_EVENT / 10; i++) {
			await addEventPhotos(
				'e1',
				'usr-1',
				Array.from({ length: 10 }, () => jpeg()),
				NOW
			);
		}
		await expect(addEventPhotos('e1', 'usr-1', [jpeg()], NOW)).rejects.toBeInstanceOf(
			RecapPhotoLimitError
		);
	});
});

describe('removeEventPhoto and describeEventPhoto', () => {
	it('detach only this event’s attachment, and never another event’s', async () => {
		await listing('e1');
		await listing('e2');
		await addEventPhotos('e1', 'usr-1', [jpeg()], NOW);
		await addEventPhotos('e2', 'usr-1', [jpeg()], NOW);
		const [other] = await listEventPhotos('e2');

		await expect(removeEventPhoto('e1', other.attachmentId)).rejects.toBeInstanceOf(
			RecapPhotoNotFoundError
		);
		await expect(
			describeEventPhoto('e1', other.attachmentId, { altText: 'x' })
		).rejects.toBeInstanceOf(RecapPhotoNotFoundError);

		const [mine] = await listEventPhotos('e1');
		await describeEventPhoto('e1', mine.attachmentId, { altText: 'Crowd', caption: 'Encore' });
		expect((await listEventPhotos('e1'))[0]).toMatchObject({ altText: 'Crowd', caption: 'Encore' });

		await removeEventPhoto('e1', mine.attachmentId);
		expect(await listEventPhotos('e1')).toEqual([]);
		expect(await listEventPhotos('e2')).toHaveLength(1);
	});
});

describe('listRecentRecaps', () => {
	it('lists past published events with photos, newest first, first photo as cover', async () => {
		await listing('old', {
			startsAt: new Date(NOW.getTime() - 200 * HOUR),
			endsAt: new Date(NOW.getTime() - 197 * HOUR)
		});
		await listing('new');
		await listing('bare');
		await listing('cancelled');
		await addEventPhotos('old', 'usr-1', [jpeg('old.jpg')], NOW);
		await addEventPhotos('new', 'usr-1', [jpeg('first.jpg'), jpeg('second.jpg')], NOW);
		await addEventPhotos('cancelled', 'usr-1', [jpeg()], NOW);
		sqlite.exec(`update event_listing set status = 'cancelled' where id = 'cancelled'`);

		const recaps = await listRecentRecaps(6, NOW);
		expect(recaps.map((r) => r.id)).toEqual(['new', 'old']);
		const [first] = await listEventPhotos('new');
		expect(recaps[0]).toMatchObject({ photoCount: 2, coverUrl: first.url });
	});

	it('carries a plain-text excerpt of the written recap, or null', async () => {
		await listing('told', { recapText: 'A **sold-out** night.' });
		await listing('untold', { startsAt: new Date(NOW.getTime() - 100 * HOUR) });
		await addEventPhotos('told', 'usr-1', [jpeg()], NOW);
		await addEventPhotos('untold', 'usr-1', [jpeg()], NOW);

		const recaps = await listRecentRecaps(6, NOW);
		expect(recaps.map((r) => [r.id, r.excerpt])).toEqual([
			['told', 'A sold-out night.'],
			['untold', null]
		]);
	});
});

describe('setEventRecapText (#1401)', () => {
	const stored = () =>
		sqlite.prepare(`select recap_text as t from event_listing where id = 'e1'`).get() as {
			t: string | null;
		};

	it('saves the markdown trimmed, and clears it when blank', async () => {
		await listing('e1');
		await setEventRecapText('e1', '  What a *night*.\n', NOW);
		expect(stored().t).toBe('What a *night*.');

		await setEventRecapText('e1', '   ', NOW);
		expect(stored().t).toBeNull();
	});

	it('refuses to write a recap for an event that has not started or was cancelled', async () => {
		await listing('e1', {
			startsAt: new Date(NOW.getTime() + HOUR),
			endsAt: new Date(NOW.getTime() + 3 * HOUR)
		});
		await expect(setEventRecapText('e1', 'Too soon', NOW)).rejects.toBeInstanceOf(RecapClosedError);
		sqlite.exec(
			`update event_listing set status = 'cancelled', recap_text = 'Old' where id = 'e1'`
		);
		await expect(setEventRecapText('e1', 'Still no', NOW)).rejects.toBeInstanceOf(RecapClosedError);
		// Clearing is always allowed.
		await setEventRecapText('e1', '', NOW);
		expect(stored().t).toBeNull();
	});

	it('404s an unknown event', async () => {
		await expect(setEventRecapText('nope', 'Hi', NOW)).rejects.toBeInstanceOf(
			RecapEventNotFoundError
		);
	});
});
