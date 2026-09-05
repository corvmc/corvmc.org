/**
 * Rows the productions suite owns, and nothing else touches.
 *
 * Two CMC shows, deliberately asymmetric: one carries a production and one does
 * not. Both states have to be reachable — the row with no production is the
 * only way "Add production" is on the event page at all, and the row with one
 * is the only way the index's status column has anything to print.
 *
 * The one with a production is at the off-site venue, because filtering by
 * venue is the acceptance test for the absorb decision: it has to narrow to
 * this row and away from everything every other fixture seeded into the room.
 *
 * A one-act bill hangs off it so the lineup column has a headliner and a count.
 *
 * Idempotent: deletes and recreates its own rows on every run. Mirrors the D1
 * access pattern in seed-staff-user.ts.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { eventListing, eventBand } from '../../src/lib/server/db/schema/event';
import { production } from '../../src/lib/server/db/schema/production';
import { SEED_STAFF_ID } from './seed-staff-user';
import { SEED_VENUE_OFFSITE_ID } from './seed-venues';

export const SEED_PRODUCTION_EVENT_ID = 'e2e-production-event';
export const SEED_PRODUCTION_EVENT_TITLE = 'E2E Production Riverfront Night';
export const SEED_PRODUCTION_ID = 'e2e-production-record';

/** The CMC show the "Add production" test opens one on. Mutated by that test. */
export const SEED_PRODUCTION_BARE_EVENT_ID = 'e2e-production-bare-event';
export const SEED_PRODUCTION_BARE_EVENT_TITLE = 'E2E Production Unopened Night';

/**
 * A second show with no production, and nothing ever opens one on it.
 *
 * The bare event above cannot serve for both: the test that opens a production
 * on it runs first in a single worker, so by the time the index asserted "No
 * production" the row had one. A fixture a sibling test mutates is fine to
 * read — this is the row that must still be in the state it was seeded in.
 */
export const SEED_PRODUCTION_EMPTY_EVENT_ID = 'e2e-production-empty-event';
export const SEED_PRODUCTION_EMPTY_EVENT_TITLE = 'E2E Production Never Opened';

export const SEED_PRODUCTION_HEADLINER = 'E2E Sunbathers';

const EVENT_IDS = [
	SEED_PRODUCTION_EVENT_ID,
	SEED_PRODUCTION_BARE_EVENT_ID,
	SEED_PRODUCTION_EMPTY_EVENT_ID
];

export async function seedProductions(): Promise<void> {
	await withPlatformDb(async (db) => {
		// `production` and `event_band` both cascade from the listing, so deleting
		// the events clears everything this fixture wrote.
		await db.delete(eventListing).where(inArray(eventListing.id, EVENT_IDS));

		const now = new Date();
		// Far enough out that no other fixture's booking window collides, and in
		// the future so the row sorts to the top of a newest-first index.
		const starts = new Date('2031-04-18T02:00:00Z');
		const ends = new Date('2031-04-18T06:00:00Z');

		await db.insert(eventListing).values([
			{
				id: SEED_PRODUCTION_EVENT_ID,
				title: SEED_PRODUCTION_EVENT_TITLE,
				startsAt: starts,
				endsAt: ends,
				status: 'published',
				publishedAt: now,
				source: 'cmc',
				kind: 'show',
				venueId: SEED_VENUE_OFFSITE_ID,
				createdByUserId: SEED_STAFF_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_PRODUCTION_BARE_EVENT_ID,
				title: SEED_PRODUCTION_BARE_EVENT_TITLE,
				startsAt: new Date('2031-04-19T02:00:00Z'),
				endsAt: new Date('2031-04-19T06:00:00Z'),
				status: 'draft',
				source: 'cmc',
				kind: 'show',
				venueId: SEED_VENUE_OFFSITE_ID,
				createdByUserId: SEED_STAFF_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_PRODUCTION_EMPTY_EVENT_ID,
				title: SEED_PRODUCTION_EMPTY_EVENT_TITLE,
				startsAt: new Date('2031-04-20T02:00:00Z'),
				endsAt: new Date('2031-04-20T06:00:00Z'),
				status: 'draft',
				source: 'cmc',
				kind: 'show',
				venueId: SEED_VENUE_OFFSITE_ID,
				createdByUserId: SEED_STAFF_ID,
				createdAt: now,
				updatedAt: now
			}
		]);

		await db.insert(eventBand).values({
			id: 'e2e-production-bill-headliner',
			eventId: SEED_PRODUCTION_EVENT_ID,
			name: SEED_PRODUCTION_HEADLINER,
			billingOrder: 0,
			status: 'unlinked',
			createdAt: now
		});

		// `draft`, so the advance path — offer, confirm — is walkable from the top.
		await db.insert(production).values({
			id: SEED_PRODUCTION_ID,
			eventId: SEED_PRODUCTION_EVENT_ID,
			status: 'draft',
			createdByUserId: SEED_STAFF_ID,
			createdAt: now,
			updatedAt: now
		});
	});
}
