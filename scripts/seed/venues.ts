import { venue } from '../../src/lib/server/db/schema/venue';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { eq, isNull } from 'drizzle-orm';
import { batchInsert, db } from './db';

/**
 * Where shows happen: our room, and the two we most often produce in.
 *
 * The primary row is the load-bearing one. `holdsSpace()` reads "no venue" as
 * "assume the room", so without it every event behaves as though it were
 * off-site — which is exactly backwards, and invisible until somebody wonders
 * why the practice space is free during a show.
 *
 * The off-site rows exist so the difference is renderable locally at all: with
 * only one venue the picker has nothing to pick and the production console's
 * off-site branch is unreachable.
 */
export async function seedVenues(events: any[]) {
	console.log('Seeding venues...');

	await batchInsert(venue, [
		{
			id: 'seed-venue-room',
			name: 'The Practice Room',
			slug: 'practice-room',
			isPrimary: true,
			address1: '4880 SW Philomath Blvd',
			city: 'Corvallis',
			state: 'OR',
			postalCode: '97333',
			capacity: 60,
			loadInNotes: 'Alley door, ring the buzzer. Two steps up, no ramp.'
		},
		{
			id: 'seed-venue-park',
			name: 'Central Park Community Stage',
			slug: 'central-park-community-stage',
			isPrimary: false,
			city: 'Corvallis',
			state: 'OR',
			capacity: 400,
			contactName: 'Festival production office',
			loadInNotes: 'Van to the NW corner off 6th. Generator is theirs; we bring everything else.'
		},
		{
			id: 'seed-venue-hall',
			name: 'Whiteside Theatre',
			slug: 'whiteside-theatre',
			isPrimary: false,
			address1: '361 SW Madison Ave',
			city: 'Corvallis',
			state: 'OR',
			capacity: 500,
			contactName: 'House manager'
		}
	]);

	// Backfill: every existing CMC show was in the room, because until this table
	// there was nowhere else it could have been.
	await db
		.update(eventListing)
		.set({ venueId: 'seed-venue-room' })
		.where(isNull(eventListing.venueId));

	// One published show moved off-site, so the console's off-site branch and the
	// "no room held" copy are both reachable without editing anything by hand.
	const offSite = events.find(
		(e: any) => e.status === 'published' && e.source === 'cmc' && e.startsAt > new Date()
	);
	if (offSite) {
		await db
			.update(eventListing)
			.set({ venueId: 'seed-venue-hall', location: 'Whiteside Theatre, 361 SW Madison Ave' })
			.where(eq(eventListing.id, offSite.id));
	}

	return { venues: 3, offSiteEventId: offSite?.id ?? null };
}
