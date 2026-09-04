/**
 * Rows the staff events split owns, and nothing else touches.
 *
 * The split is proved by pairs of assertions — a row present on one staff page
 * and absent from the other — so every row here has to still be in the state it
 * was seeded in when the assertion runs. Borrowing `seed-community-events`'
 * rows did not survive that: `community-events.e2e.ts` sorts first, and it
 * approves its pending listing and deletes its CMC draft, so by the time this
 * suite looked for them they were gone or moved. Shared fixtures are fine to
 * read; these are fixtures a sibling suite *mutates*.
 *
 * One author for all of them. The point being tested is which page a row lands
 * on, which is decided by `source` and `status` alone — a second member would
 * add a variable the assertions do not read.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { scryptHash } from './seed-pay-reservation';

export const SEED_SPLIT_PASSWORD = 'e2e-password-123';
export const SEED_SPLIT_MEMBER_ID = 'e2e-split-member';
export const SEED_SPLIT_MEMBER_EMAIL = 'e2e.split.member@example.com';
export const SEED_SPLIT_MEMBER_NAME = 'E2E Split Lister';

/** CMC, draft. Production work: on Productions, never on the Calendar. */
export const SEED_SPLIT_CMC_DRAFT_ID = 'e2e-split-cmc-draft';
export const SEED_SPLIT_CMC_DRAFT_TITLE = 'E2E Split Unfinished Showcase';

/** CMC, published. The row that is deliberately on *both* pages. */
export const SEED_SPLIT_CMC_LIVE_ID = 'e2e-split-cmc-live';
export const SEED_SPLIT_CMC_LIVE_TITLE = 'E2E Split Mainstage Night';

/** Community, pending_review. The queue's row. */
export const SEED_SPLIT_PENDING_ID = 'e2e-split-pending';
export const SEED_SPLIT_PENDING_TITLE = 'E2E Split Awaiting Review';

/** Community, published. On the Calendar, never on Productions. */
export const SEED_SPLIT_LIVE_ID = 'e2e-split-community-live';
export const SEED_SPLIT_LIVE_TITLE = 'E2E Split Warehouse Gig';

/** Community, draft. A member's private working copy — on neither page. */
export const SEED_SPLIT_DRAFT_ID = 'e2e-split-community-draft';
export const SEED_SPLIT_DRAFT_TITLE = 'E2E Split Private Scratchpad';

/**
 * The pair that proves the "within two hours" panel: one an hour after the
 * pending listing, one six hours after. Same day for both, so a day-wide query
 * would return them both and only a real window tells them apart.
 */
export const SEED_SPLIT_NEAR_ID = 'e2e-split-near';
export const SEED_SPLIT_NEAR_TITLE = 'E2E Split Same Slot Show';
export const SEED_SPLIT_FAR_ID = 'e2e-split-far';
export const SEED_SPLIT_FAR_TITLE = 'E2E Split Later That Night';

const EVENT_IDS = [
	SEED_SPLIT_CMC_DRAFT_ID,
	SEED_SPLIT_CMC_LIVE_ID,
	SEED_SPLIT_PENDING_ID,
	SEED_SPLIT_LIVE_ID,
	SEED_SPLIT_DRAFT_ID,
	SEED_SPLIT_NEAR_ID,
	SEED_SPLIT_FAR_ID
];

/**
 * Far enough out that nothing ages past the calendar's `startsAt >= today`
 * floor mid-run, and spread so the day-group headers have something to group.
 */
function daysFromNow(days: number, hour = 20): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d;
}

/** Offset from a seeded show, for the window pair. */
function hoursAfter(base: Date, hours: number): Date {
	return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export async function seedEventsSplit(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(eventListing).where(inArray(eventListing.id, EVENT_IDS));
		await db.delete(account).where(inArray(account.userId, [SEED_SPLIT_MEMBER_ID]));
		await db.delete(user).where(inArray(user.id, [SEED_SPLIT_MEMBER_ID]));

		const now = new Date();

		await db.insert(user).values({
			id: SEED_SPLIT_MEMBER_ID,
			name: SEED_SPLIT_MEMBER_NAME,
			email: SEED_SPLIT_MEMBER_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});
		await db.insert(account).values({
			id: `${SEED_SPLIT_MEMBER_ID}-account`,
			accountId: SEED_SPLIT_MEMBER_ID,
			providerId: 'credential',
			userId: SEED_SPLIT_MEMBER_ID,
			password: await scryptHash(SEED_SPLIT_PASSWORD),
			createdAt: now,
			updatedAt: now
		});

		for (const row of [
			{
				id: SEED_SPLIT_CMC_DRAFT_ID,
				title: SEED_SPLIT_CMC_DRAFT_TITLE,
				startsAt: daysFromNow(24),
				// A CMC row needs an end: `event_cmc_needs_end` is a check constraint.
				endsAt: daysFromNow(24, 23),
				source: 'cmc' as const,
				status: 'draft' as const,
				publishedAt: null
			},
			{
				id: SEED_SPLIT_CMC_LIVE_ID,
				title: SEED_SPLIT_CMC_LIVE_TITLE,
				startsAt: daysFromNow(25),
				endsAt: daysFromNow(25, 23),
				source: 'cmc' as const,
				status: 'published' as const,
				publishedAt: now
			},
			{
				id: SEED_SPLIT_PENDING_ID,
				title: SEED_SPLIT_PENDING_TITLE,
				startsAt: daysFromNow(26),
				endsAt: null,
				source: 'community' as const,
				status: 'pending_review' as const,
				publishedAt: null
			},
			{
				id: SEED_SPLIT_LIVE_ID,
				title: SEED_SPLIT_LIVE_TITLE,
				startsAt: daysFromNow(27),
				endsAt: null,
				source: 'community' as const,
				status: 'published' as const,
				publishedAt: now
			},
			{
				id: SEED_SPLIT_DRAFT_ID,
				title: SEED_SPLIT_DRAFT_TITLE,
				startsAt: daysFromNow(28),
				endsAt: null,
				source: 'community' as const,
				status: 'draft' as const,
				publishedAt: null
			},
			{
				id: SEED_SPLIT_NEAR_ID,
				title: SEED_SPLIT_NEAR_TITLE,
				startsAt: hoursAfter(daysFromNow(26), 1),
				endsAt: null,
				source: 'community' as const,
				status: 'published' as const,
				publishedAt: now
			},
			{
				id: SEED_SPLIT_FAR_ID,
				title: SEED_SPLIT_FAR_TITLE,
				startsAt: hoursAfter(daysFromNow(26), 6),
				endsAt: null,
				source: 'community' as const,
				status: 'published' as const,
				publishedAt: now
			}
		]) {
			await db.insert(eventListing).values({
				...row,
				location: 'E2E Split Venue',
				createdByUserId: SEED_SPLIT_MEMBER_ID,
				createdAt: now,
				updatedAt: now
			});
		}
	});
}
