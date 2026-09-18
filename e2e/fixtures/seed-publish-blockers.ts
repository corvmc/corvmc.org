/**
 * Two CMC drafts for the publish-readiness e2e: one that cannot go public and
 * one that can. Neither is published by the test — a published row would make
 * the second run assert against what the first run left behind.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { SEED_STAFF_ID } from './seed-staff-user';

/** No poster and no description, so `publishBlockers` names both. */
export const SEED_BLOCKED_EVENT_ID = 'e2e-publish-blocked';
export const SEED_BLOCKED_EVENT_TITLE = 'E2E Publish Not Ready Yet';

/** Poster and description present, no production row — nothing blocking. */
export const SEED_READY_EVENT_ID = 'e2e-publish-ready';
export const SEED_READY_EVENT_TITLE = 'E2E Publish Ready To Go';

const EVENT_IDS = [SEED_BLOCKED_EVENT_ID, SEED_READY_EVENT_ID];

/** The poster is an attachment, not a column — see #808. */
const READY_MEDIA_ID = 'e2e-publish-ready-poster';
const READY_POSTER_KEY = 'e2e/publish-ready-poster.jpg';

function daysFromNow(days: number, hour = 20): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d;
}

export async function seedPublishBlockers(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(eventListing).where(inArray(eventListing.id, EVENT_IDS));
		await db.delete(media).where(eq(media.id, READY_MEDIA_ID));

		const now = new Date();
		for (const row of [
			{
				id: SEED_BLOCKED_EVENT_ID,
				title: SEED_BLOCKED_EVENT_TITLE,
				startsAt: daysFromNow(41),
				// A CMC row needs an end: `event_cmc_needs_end` is a check constraint.
				endsAt: daysFromNow(41, 23),
				description: null
			},
			{
				id: SEED_READY_EVENT_ID,
				title: SEED_READY_EVENT_TITLE,
				startsAt: daysFromNow(42),
				endsAt: daysFromNow(42, 23),
				description: 'Three bands, doors at seven, all ages.'
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

		// `publishBlockers` resolves the poster through `media_attachment`, so the
		// ready listing needs a real attachment rather than a key on the row.
		// `media_attachment` cascades from `media`, so the delete above is enough.
		await db.insert(media).values({
			id: READY_MEDIA_ID,
			key: READY_POSTER_KEY,
			contentType: 'image/jpeg',
			byteSize: 120_000
		});
		await db.insert(mediaAttachment).values({
			mediaId: READY_MEDIA_ID,
			attachableType: 'event_listing',
			attachableId: SEED_READY_EVENT_ID,
			slot: 'poster'
		});
	});
}
