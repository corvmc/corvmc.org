/**
 * Two CMC drafts for the publish-readiness e2e: one that cannot go public and
 * one that can.
 *
 * Read-only for the suite that uses it — neither row is published by the test,
 * because a published row would make the second run assert against a state the
 * first run left behind.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { SEED_STAFF_ID } from './seed-staff-user';

/** No poster and no description, so `publishBlockers` names both. */
export const SEED_BLOCKED_EVENT_ID = 'e2e-publish-blocked';
export const SEED_BLOCKED_EVENT_TITLE = 'E2E Publish Not Ready Yet';

/** Poster and description present, no production row — nothing blocking. */
export const SEED_READY_EVENT_ID = 'e2e-publish-ready';
export const SEED_READY_EVENT_TITLE = 'E2E Publish Ready To Go';

const EVENT_IDS = [SEED_BLOCKED_EVENT_ID, SEED_READY_EVENT_ID];

function daysFromNow(days: number, hour = 20): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d;
}

export async function seedPublishBlockers(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(eventListing).where(inArray(eventListing.id, EVENT_IDS));

		const now = new Date();
		for (const row of [
			{
				id: SEED_BLOCKED_EVENT_ID,
				title: SEED_BLOCKED_EVENT_TITLE,
				startsAt: daysFromNow(41),
				// A CMC row needs an end: `event_cmc_needs_end` is a check constraint.
				endsAt: daysFromNow(41, 23),
				description: null,
				posterKey: null
			},
			{
				id: SEED_READY_EVENT_ID,
				title: SEED_READY_EVENT_TITLE,
				startsAt: daysFromNow(42),
				endsAt: daysFromNow(42, 23),
				description: 'Three bands, doors at seven, all ages.',
				posterKey: 'e2e/publish-ready-poster.jpg'
			}
		]) {
			await db.insert(eventListing).values({
				...row,
				source: 'cmc',
				status: 'draft',
				publishedAt: null,
				location: 'E2E Publish Venue',
				createdByUserId: SEED_STAFF_ID,
				createdAt: now,
				updatedAt: now
			});
		}
	});
}
