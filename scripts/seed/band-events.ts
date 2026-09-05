import { eventListing, eventGroup } from '../../src/lib/server/db/schema/event';
import { db } from './db';
import { seedLineup } from './lineups';
import {
	BAND_EVENT_LOCATIONS,
	BAND_EVENT_TITLES,
	EVENT_TAGS_POOL,
	SUPPORT_BAND_NAMES
} from './pools';
import { type SeedUser } from './types';
import { pick, pickN, ptDate, random, randomInt } from './util';

export async function seedBandEvents(bands: any[], _users: SeedUser[]) {
	console.log('Seeding band events...');
	const rows = [];

	// The first live band gets a two-year backlog so the profile's past-shows
	// pager has more than one page to page through.
	const veteran = bands.find((b: any) => !b.deletedAt);
	if (veteran) {
		for (let i = 0; i < 25; i++) {
			const day = -randomInt(20, 730);
			const hour = randomInt(19, 21);
			const startsAt = ptDate(day, hour);
			const [e] = await db
				.insert(eventListing)
				.values({
					title: pick(BAND_EVENT_TITLES),
					description: `${veteran.name} live! An old favourite from the archives.`,
					startsAt,
					endsAt: random() > 0.5 ? ptDate(day, hour + pick([2, 3, 4])) : null,
					doorsAt: ptDate(day, hour - 0.5),
					status: 'published',
					publishedAt: new Date(startsAt.getTime() - 14 * 86400000),
					tags: pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', '),
					groupId: veteran.id,
					source: 'band',
					location: pick(BAND_EVENT_LOCATIONS),
					ticketPrice: random() > 0.35 ? pick([500, 1000, 1200, 1500]) : null,
					createdByUserId: veteran.ownerId
				})
				.returning();

			// Half the archive has no end time — a band backfilling old gigs
			// rarely remembers when the night finished, which is why the column
			// is nullable.
			await seedLineup(
				e.id,
				{ id: veteran.id, name: veteran.name },
				pickN(SUPPORT_BAND_NAMES, randomInt(0, 2)).map((name) => ({ name }))
			);
			rows.push(e);
		}
	}

	for (const b of bands.slice(0, 6)) {
		if (b.deletedAt) continue;
		const eventCount = randomInt(2, 4);

		for (let i = 0; i < eventCount; i++) {
			const day = randomInt(-10, 30);
			const hour = randomInt(19, 21);
			const duration = pick([2, 3, 4]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			const isPast = day < 0;

			const [e] = await db
				.insert(eventListing)
				.values({
					title: pick(BAND_EVENT_TITLES),
					description: `${b.name} live! Join us for a night of original music and good vibes. All ages welcome.`,
					startsAt,
					endsAt,
					doorsAt: ptDate(day, hour - 0.5),
					status: isPast ? 'published' : pick(['published', 'published', 'draft']),
					publishedAt: isPast
						? new Date(startsAt.getTime() - 14 * 86400000)
						: random() > 0.3
							? new Date()
							: null,
					tags: pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', '),
					groupId: b.id,
					source: 'band',
					location: pick(BAND_EVENT_LOCATIONS),
					externalTicketUrl:
						random() > 0.5 ? `https://eventbrite.com/e/${randomInt(100000, 999999)}` : null,
					// Gigs are priced at the door or by the venue — never sold by us.
					ticketPrice: random() > 0.35 ? pick([500, 1000, 1200, 1500]) : null,
					createdByUserId: b.ownerId
				})
				.returning();

			// Roughly a third of gigs get support. Mostly off-platform names; the
			// first band on the list also gets a real CMC band so the invitation
			// inbox has something in it, and a declined slot so that render path
			// is visible too.
			const support: { name: string; bandId?: string; status?: string }[] = [];
			if (random() > 0.66) {
				support.push(...pickN(SUPPORT_BAND_NAMES, randomInt(1, 2)).map((name) => ({ name })));
			}
			const otherBand = bands.find((x: any) => x.id !== b.id && !x.deletedAt);
			if (otherBand && i === 0) {
				support.push({
					name: otherBand.name,
					bandId: otherBand.id,
					status: pick(['pending', 'pending', 'confirmed', 'declined'])
				});
			}
			await seedLineup(e.id, { id: b.id, name: b.name }, support);
			rows.push(e);
		}
	}

	// The managing group's own `event_group` row, for every event seeded above.
	//
	// These inserts go straight to the table rather than through
	// `createBandEvent`, so the invariant that service maintains has to be
	// restated here — and it is restated as one pass over what was written
	// rather than beside each insert, which is how the two would drift.
	// Chunked at 20: D1 caps a statement at 100 bound params.
	const links = rows
		.filter((e) => e.groupId)
		.map((e) => ({ eventId: e.id, groupId: e.groupId as string, sortOrder: 0 }));
	for (let i = 0; i < links.length; i += 20) {
		await db.insert(eventGroup).values(links.slice(i, i + 20));
	}

	return rows;
}
