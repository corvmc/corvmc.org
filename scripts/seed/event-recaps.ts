import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { db } from './db';
import { type SeedEvent } from './types';

const CAPTIONS = [
	'Doors, and the first of the line',
	null,
	'The headliner’s second song',
	null,
	'Everyone on stage for the last one'
];

/**
 * Recap photos on the two most recent past published shows, five and three,
 * so the event gallery and the /events recaps strip both render. Captions and
 * alt text on some but not all: the undescribed fallbacks must stay reachable.
 * The keys name no real object, as every seeded media key does.
 */
export async function seedEventRecaps(
	events: SeedEvent[],
	uploadedByUserId: string
): Promise<number> {
	const now = Date.now();
	const past = events
		.filter((e) => e.status === 'published' && e.startsAt.getTime() < now)
		.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
		.slice(0, 2);

	let count = 0;
	for (const [i, evt] of past.entries()) {
		const photos = i === 0 ? 5 : 3;
		for (let n = 0; n < photos; n++) {
			const [row] = await db
				.insert(media)
				.values({
					key: `events/photos/${evt.id}-seed${n}.jpg`,
					contentType: 'image/jpeg',
					byteSize: 240_000 + n * 1000,
					filename: `IMG_${4200 + n}.jpg`,
					altText: n % 2 === 0 ? 'The band on stage under warm lights, the room full' : null,
					caption: CAPTIONS[n] ?? null,
					uploadedByUserId
				})
				.returning();
			await db.insert(mediaAttachment).values({
				mediaId: row.id,
				attachableType: 'event_listing',
				attachableId: evt.id,
				slot: 'gallery',
				sortOrder: n
			});
			count++;
		}
	}
	return count;
}
