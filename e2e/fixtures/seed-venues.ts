/**
 * Venues for the e2e suite: our room, and one that is not.
 *
 * The whole feature turns on telling those two apart, so a fixture with one
 * venue could not test anything — the picker would have nothing to pick and the
 * off-site branch would be unreachable.
 *
 * Idempotent: deletes and recreates its own rows on every run. The event
 * backfill matters as much as the rows do, because `holdsSpace()` reads a null
 * `venue_id` as *our room* and every other fixture's events have one.
 *
 * Mirrors the D1 access pattern in seed-staff-user.ts.
 */
import { inArray, isNull } from 'drizzle-orm';
import { withPlatformEnv } from './platform-db';
import { venue } from '../../src/lib/server/db/schema/venue';
import { event } from '../../src/lib/server/db/schema/event';

export const SEED_VENUE_ROOM_ID = 'e2e-venue-room';
export const SEED_VENUE_ROOM_NAME = 'E2E Practice Room';

export const SEED_VENUE_OFFSITE_ID = 'e2e-venue-offsite';
export const SEED_VENUE_OFFSITE_NAME = 'E2E Riverfront Stage';

/** Archived, so the picker's exclusion of them is assertable. */
export const SEED_VENUE_ARCHIVED_ID = 'e2e-venue-archived';
export const SEED_VENUE_ARCHIVED_NAME = 'E2E Closed Hall';

const VENUE_IDS = [SEED_VENUE_ROOM_ID, SEED_VENUE_OFFSITE_ID, SEED_VENUE_ARCHIVED_ID];

export async function seedVenues(): Promise<void> {
	await withPlatformEnv(async ({ db }) => {
		// `event.venue_id` is ON DELETE SET NULL, so events survive this and are
		// re-pointed below.
		await db.delete(venue).where(inArray(venue.id, VENUE_IDS));

		const now = new Date();

		await db.insert(venue).values([
			{
				id: SEED_VENUE_ROOM_ID,
				name: SEED_VENUE_ROOM_NAME,
				slug: 'e2e-practice-room',
				isPrimary: true,
				city: 'Corvallis',
				state: 'OR',
				capacity: 60,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VENUE_OFFSITE_ID,
				name: SEED_VENUE_OFFSITE_NAME,
				slug: 'e2e-riverfront-stage',
				isPrimary: false,
				city: 'Corvallis',
				state: 'OR',
				capacity: 400,
				loadInNotes: 'E2E van to the north gate.',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VENUE_ARCHIVED_ID,
				name: SEED_VENUE_ARCHIVED_NAME,
				slug: 'e2e-closed-hall',
				isPrimary: false,
				deletedAt: now,
				createdAt: now,
				updatedAt: now
			}
		]);

		// Every event the other fixtures wrote was in the room, because until this
		// table there was nowhere else it could have been. Leaving them null would
		// still read as the room, but only by the fallback — pointing them at it
		// makes the fixture say so.
		await db.update(event).set({ venueId: SEED_VENUE_ROOM_ID }).where(isNull(event.venueId));
	});
}
