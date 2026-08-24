/**
 * Seed member-authored community listings for the e2e suite.
 *
 * Why this exists: the community-listing flows that unit tests cannot reach are
 * all client-server round trips over state that has to move in the right
 * direction —
 *
 *   - a draft must be absent from BOTH the public guide and the staff review
 *     queue. Two negatives that no unit test can prove together, and the one
 *     mistake here (draft leaking into the queue) puts members' unfinished
 *     writing in front of staff.
 *   - publishing has to actually reach `/events`, through the real query the
 *     public page uses.
 *   - a rejection has to surface its reason to the member as written English,
 *     not raw Zod text, and the fixed-up listing has to make it back to staff.
 *
 * Two members, deliberately: one trusted (publishes straight through) and one
 * already review-required (everything queues). Seeding the second's standing
 * rather than driving it through the flag queue keeps this suite independent of
 * the moderation suite.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { readLocalDb, withPlatformDb } from './platform-db';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { event } from '../../src/lib/server/db/schema/event';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { scryptHash } from './seed-pay-reservation';

export const SEED_CE_PASSWORD = 'e2e-password-123';

/** Publishes straight to the calendar. */
export const SEED_CE_TRUSTED_ID = 'e2e-ce-trusted';
export const SEED_CE_TRUSTED_EMAIL = 'e2e.listing.trusted@example.com';
export const SEED_CE_TRUSTED_NAME = 'E2E Trusted Lister';

/** Review-required: a report against an earlier listing was upheld. */
export const SEED_CE_REVIEW_ID = 'e2e-ce-review';
export const SEED_CE_REVIEW_EMAIL = 'e2e.listing.review@example.com';
export const SEED_CE_REVIEW_NAME = 'E2E Reviewed Lister';
export const SEED_CE_STANDING_REASON = 'E2E: an earlier listing had no venue.';

/** The trusted member's draft — must reach neither the guide nor the queue. */
export const SEED_CE_DRAFT_ID = 'e2e-ce-draft';
export const SEED_CE_DRAFT_TITLE = 'E2E Draft Basement Show';

/** Already live, so the public guide has something to match on first load. */
export const SEED_CE_PUBLISHED_ID = 'e2e-ce-published';
export const SEED_CE_PUBLISHED_TITLE = 'E2E Published Warehouse Show';

/** The review-required member's draft, for the submit-to-queue path. */
export const SEED_CE_QUEUE_DRAFT_ID = 'e2e-ce-queue-draft';
export const SEED_CE_QUEUE_DRAFT_TITLE = 'E2E Queued Songwriter Round';

/**
 * Already in the queue, owned by the review-required member. Separate from the
 * draft above so the rejection test stands on its own rather than depending on
 * the submit test having run first.
 */
export const SEED_CE_PENDING_ID = 'e2e-ce-pending';
export const SEED_CE_PENDING_TITLE = 'E2E Pending Jazz Night';

/**
 * Two CMC events for the staff delete control: one clean, one with a ticket
 * sold. The ticketed one must be undeletable — cancel is the end state there,
 * because the ticket row is a payment record and `ticket.eventId` cascades.
 */
export const SEED_CE_DELETABLE_ID = 'e2e-ce-deletable';
export const SEED_CE_DELETABLE_TITLE = 'E2E Deletable Test Event';
export const SEED_CE_TICKETED_ID = 'e2e-ce-ticketed';
export const SEED_CE_TICKETED_TITLE = 'E2E Ticketed Event';

/** Cancelled, and still on the guide — the cancellation is the announcement. */
export const SEED_CE_CANCELLED_ID = 'e2e-ce-cancelled';
export const SEED_CE_CANCELLED_TITLE = 'E2E Called Off Folk Night';

const MEMBER_IDS = [SEED_CE_TRUSTED_ID, SEED_CE_REVIEW_ID];
const EVENT_IDS = [
	SEED_CE_DRAFT_ID,
	SEED_CE_PUBLISHED_ID,
	SEED_CE_QUEUE_DRAFT_ID,
	SEED_CE_PENDING_ID,
	SEED_CE_DELETABLE_ID,
	SEED_CE_TICKETED_ID,
	SEED_CE_CANCELLED_ID
];

function daysFromNow(days: number, hour = 20): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d;
}

export async function seedCommunityEvents(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Standing before user: it points at both.
		await db.delete(memberStanding).where(inArray(memberStanding.userId, MEMBER_IDS));
		await db.delete(ticket).where(inArray(ticket.eventId, EVENT_IDS));
		await db.delete(event).where(inArray(event.id, EVENT_IDS));
		await db.delete(event).where(inArray(event.createdByUserId, MEMBER_IDS));
		await db.delete(account).where(inArray(account.userId, MEMBER_IDS));
		await db.delete(user).where(inArray(user.id, MEMBER_IDS));

		const now = new Date();
		const passwordHash = await scryptHash(SEED_CE_PASSWORD);

		for (const [id, email, name] of [
			[SEED_CE_TRUSTED_ID, SEED_CE_TRUSTED_EMAIL, SEED_CE_TRUSTED_NAME],
			[SEED_CE_REVIEW_ID, SEED_CE_REVIEW_EMAIL, SEED_CE_REVIEW_NAME]
		] as const) {
			await db.insert(user).values({
				id,
				name,
				email,
				emailVerified: true,
				createdAt: now,
				updatedAt: now
			});
			await db.insert(account).values({
				id: `${id}-account`,
				accountId: id,
				providerId: 'credential',
				userId: id,
				password: passwordHash,
				createdAt: now,
				updatedAt: now
			});
		}

		await db.insert(memberStanding).values({
			userId: SEED_CE_REVIEW_ID,
			scope: 'community_event',
			status: 'restricted',
			reason: SEED_CE_STANDING_REASON,
			updatedAt: now
		});

		await db.insert(event).values([
			{
				id: SEED_CE_DRAFT_ID,
				title: SEED_CE_DRAFT_TITLE,
				startsAt: daysFromNow(14),
				endsAt: null,
				location: 'E2E Somewhere',
				source: 'community',
				status: 'draft',
				createdByUserId: SEED_CE_TRUSTED_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_CE_PUBLISHED_ID,
				title: SEED_CE_PUBLISHED_TITLE,
				startsAt: daysFromNow(10),
				endsAt: null,
				location: 'E2E Warehouse',
				source: 'community',
				status: 'published',
				publishedAt: now,
				createdByUserId: SEED_CE_TRUSTED_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_CE_QUEUE_DRAFT_ID,
				title: SEED_CE_QUEUE_DRAFT_TITLE,
				startsAt: daysFromNow(18),
				endsAt: null,
				location: 'E2E Back Room',
				source: 'community',
				status: 'draft',
				createdByUserId: SEED_CE_REVIEW_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_CE_PENDING_ID,
				title: SEED_CE_PENDING_TITLE,
				startsAt: daysFromNow(16),
				endsAt: null,
				location: 'E2E Side Room',
				source: 'community',
				status: 'pending_review',
				createdByUserId: SEED_CE_REVIEW_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_CE_DELETABLE_ID,
				title: SEED_CE_DELETABLE_TITLE,
				startsAt: daysFromNow(20),
				endsAt: daysFromNow(20, 23),
				location: 'E2E Practice Room',
				source: 'cmc',
				status: 'draft',
				createdByUserId: SEED_CE_TRUSTED_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_CE_TICKETED_ID,
				title: SEED_CE_TICKETED_TITLE,
				startsAt: daysFromNow(22),
				endsAt: daysFromNow(22, 23),
				location: 'E2E Main Room',
				source: 'cmc',
				status: 'published',
				publishedAt: now,
				ticketingEnabled: true,
				ticketPrice: 1000,
				createdByUserId: SEED_CE_TRUSTED_ID,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_CE_CANCELLED_ID,
				title: SEED_CE_CANCELLED_TITLE,
				startsAt: daysFromNow(7),
				endsAt: null,
				location: 'E2E Church Hall',
				source: 'community',
				status: 'cancelled',
				publishedAt: now,
				createdByUserId: SEED_CE_TRUSTED_ID,
				createdAt: now,
				updatedAt: now
			}
		]);

		await db.insert(ticket).values({
			id: 'e2e-ce-ticket',
			eventId: SEED_CE_TICKETED_ID,
			purchaseId: 'e2e-ce-purchase',
			attendeeName: 'E2E Attendee',
			attendeeEmail: 'e2e.attendee@example.com',
			code: 'E2E-TICKET-1',
			status: 'valid',
			createdAt: now,
			updatedAt: now
		});
	});
}

/** Whether a row still exists, for the delete assertions. */
export async function eventExists(eventId: string): Promise<boolean> {
	return readLocalDb(async (db) => {
		const [row] = await db
			.select({ id: event.id })
			.from(event)
			.where(eq(event.id, eventId))
			.limit(1);
		return !!row;
	});
}

/** Read back what the app wrote, for assertions the UI cannot make. */
export async function readListingState(eventId: string): Promise<{
	status: string | null;
	reviewNotes: string | null;
}> {
	return readLocalDb(async (db) => {
		const [row] = await db
			.select({ status: event.status, reviewNotes: event.reviewNotes })
			.from(event)
			.where(eq(event.id, eventId))
			.limit(1);
		return { status: row?.status ?? null, reviewNotes: row?.reviewNotes ?? null };
	});
}
