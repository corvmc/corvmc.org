/**
 * A free CMC workshop (no ticket_sale row) and a member to RSVP to it, for the
 * signed-out RSVP e2e (#1995). Both are the spec's alone, since it writes an
 * RSVP. Idempotent: recreated each run, which clears the last run's RSVP.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformDb } from './platform-db';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { eventRsvp } from '../../src/lib/server/db/schema/event-rsvp';
import { scryptHash } from './seed-pay-reservation';
import { SEED_STAFF_ID } from './seed-staff-user';

export const SEED_RSVP_EVENT_ID = 'e2e-rsvp-workshop';
export const SEED_RSVP_EVENT_TITLE = 'E2E Mixing Workshop';
export const SEED_RSVP_MEMBER_ID = 'e2e-rsvp-member';
export const SEED_RSVP_MEMBER_EMAIL = 'e2e.rsvp.member@example.com';
export const SEED_RSVP_MEMBER_NAME = 'E2E Rsvp Member';
export const SEED_RSVP_MEMBER_PASSWORD = 'e2e-password-123';

export async function seedRsvp(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(eventRsvp).where(inArray(eventRsvp.eventId, [SEED_RSVP_EVENT_ID]));
		await db.delete(eventListing).where(inArray(eventListing.id, [SEED_RSVP_EVENT_ID]));
		await db.delete(account).where(inArray(account.userId, [SEED_RSVP_MEMBER_ID]));
		await db.delete(user).where(inArray(user.id, [SEED_RSVP_MEMBER_ID]));

		const now = new Date();
		await db.insert(user).values({
			id: SEED_RSVP_MEMBER_ID,
			name: SEED_RSVP_MEMBER_NAME,
			email: SEED_RSVP_MEMBER_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});
		await db.insert(account).values({
			id: 'e2e-rsvp-member-account',
			accountId: SEED_RSVP_MEMBER_ID,
			providerId: 'credential',
			userId: SEED_RSVP_MEMBER_ID,
			password: await scryptHash(SEED_RSVP_MEMBER_PASSWORD),
			createdAt: now,
			updatedAt: now
		});

		const startsAt = new Date();
		startsAt.setDate(startsAt.getDate() + 14);
		startsAt.setHours(18, 0, 0, 0);
		await db.insert(eventListing).values({
			id: SEED_RSVP_EVENT_ID,
			title: SEED_RSVP_EVENT_TITLE,
			description: 'Seeded for the RSVP sign-in e2e.',
			startsAt,
			endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
			status: 'published',
			publishedAt: now,
			source: 'cmc',
			kind: 'class',
			createdByUserId: SEED_STAFF_ID
		});
	});
}
