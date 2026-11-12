import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What the print poster is built from: the event's own fields, its uploaded
 * image, the sponsors its page credits, and its public page. Layout is
 * `event-letter.spec.ts`'s; printing is the browser's.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const objects = new Map<string, Uint8Array>();
vi.mock('#lib/server/storage.js', () => ({
	uploadFile: async (_b: ArrayBuffer, key: string) => key,
	getObject: async (key: string) =>
		objects.has(key) ? { bytes: objects.get(key)!, contentType: 'image/png' } : null,
	resolveImageUrl: (key: string | null) => key
}));
vi.mock('./browser', () => ({ withPosterPage: vi.fn() }));

const { eventLetter, EventPosterArtMissingError } = await import('./event-letter-service');
const { FLYER_ALT_PREFIX, FlyerEventNotFoundError } = await import('./flyer-service');
const { eventUrl } = await import('./event-letter');

const EVENT = 'evt-1';

function poster(key: string, alt: string | null = null) {
	sqlite.exec(
		`insert into media (id, key, content_type, byte_size, alt_text)
		 values ('m-poster', '${key}', 'image/png', 3, ${alt ? `'${alt}'` : 'null'})`
	);
	sqlite.exec(
		`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
		 values ('a-poster', 'm-poster', 'event_listing', '${EVENT}', 'poster')`
	);
	objects.set(key, new Uint8Array([1, 2, 3]));
}

function credit(id: string, name: string, logo?: string) {
	sqlite.exec(`insert into organization (id, name) values ('${id}', '${name}')`);
	sqlite.exec(
		`insert into sponsorship (id, organization_id, title, status) values ('${id}-s', '${id}', 'Show', 'active')`
	);
	sqlite.exec(
		`insert into sponsor_placement (id, sponsorship_id, event_id, on_event_page, in_campaign)
		 values ('${id}-p', '${id}-s', '${EVENT}', 1, 1)`
	);
	if (!logo) return;
	sqlite.exec(
		`insert into media (id, key, content_type, byte_size) values ('${id}-m', '${logo}', 'image/png', 3)`
	);
	sqlite.exec(
		`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
		 values ('${id}-a', '${id}-m', 'organization', '${id}', 'logo')`
	);
	objects.set(logo, new Uint8Array([1, 2, 3]));
}

beforeEach(() => {
	for (const t of [
		'sponsor_placement',
		'sponsorship',
		'organization',
		'media_attachment',
		'media',
		'event_band',
		'ticket_sale',
		'event_listing',
		'venue'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id)
		 values ('${EVENT}', 'Harvest Show', 1790000000, 1790010000, 'u-1')`
	);
	objects.clear();
});

describe('eventLetter', () => {
	it('carries the uploaded image, the public page and nothing the event lacks', async () => {
		poster('events/posters/art.png');
		const out = await eventLetter(EVENT);
		expect(out).toMatchObject({
			art: expect.stringMatching(/^data:image\/png;base64,/),
			url: eventUrl(EVENT),
			address: null,
			sponsors: [],
			lines: { title: 'Harvest Show', doors: null, venue: null, bill: [], price: 'Free' }
		});
	});

	it("takes the venue's address when the listing has none of its own", async () => {
		sqlite.exec(
			`insert into venue (id, name, slug, address1, city, state)
			 values ('v-1', 'Whiteside', 'whiteside', '361 SW Madison Ave', 'Corvallis', 'OR')`
		);
		sqlite.exec(`update event_listing set venue_id = 'v-1', doors_at = 1789998200`);
		sqlite.exec(
			`insert into event_band (id, event_id, name, billing_order) values
			 ('b-2', '${EVENT}', 'Second', 1), ('b-1', '${EVENT}', 'First', 0)`
		);
		poster('events/posters/art.png');
		const out = await eventLetter(EVENT);
		expect(out.address).toBe('361 SW Madison Ave, Corvallis, OR');
		expect(out.lines).toMatchObject({
			venue: 'Whiteside',
			bill: ['First', 'Second'],
			doors: expect.stringMatching(/^DOORS /)
		});

		sqlite.exec(`update event_listing set address = '1 Main St'`);
		expect((await eventLetter(EVENT)).address).toBe('1 Main St');
	});

	it('credits the sponsors the event page credits, by name when there is no logo', async () => {
		credit('sp-b', 'Bean Cafe');
		credit('sp-a', 'Acme Audio', 'sponsors/logos/a.png');
		poster('events/posters/art.png');
		expect((await eventLetter(EVENT)).sponsors).toEqual([
			{ name: 'Acme Audio', src: expect.stringMatching(/^data:image\/png;base64,/) },
			{ name: 'Bean Cafe', src: null }
		]);
	});

	it('refuses an event with no poster image', async () => {
		await expect(eventLetter(EVENT)).rejects.toBeInstanceOf(EventPosterArtMissingError);
	});

	it('refuses a poster image missing from the bucket', async () => {
		poster('events/posters/art.png');
		objects.clear();
		await expect(eventLetter(EVENT)).rejects.toBeInstanceOf(EventPosterArtMissingError);
	});

	it('refuses a generated flyer, which already carries the details', async () => {
		poster('events/posters/flyer.png', `${FLYER_ALT_PREFIX}Harvest Show`);
		await expect(eventLetter(EVENT)).rejects.toBeInstanceOf(EventPosterArtMissingError);
	});

	it('refuses an event that does not exist', async () => {
		await expect(eventLetter('nope')).rejects.toBeInstanceOf(FlyerEventNotFoundError);
	});
});
