/**
 * Two teaching records for `instructor.e2e.ts`, into the LOCAL D1 the preview
 * serves.
 *
 * Must run **after** `seedDirectoryEntries`, which sweeps every seeded user into
 * a `members`-visibility entry. The public instructor listing gates on
 * `directory_entry.visibility`, so an instructor whose entry stayed at `members`
 * is correctly invisible — and a fixture that did not promote it would be
 * testing the empty state while looking like it tested the listing.
 *
 * Idempotent: deletes and recreates its rows on every run.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { instructor } from '../../src/lib/server/db/schema/instructor';
import { directoryEntry, directoryTag } from '../../src/lib/server/db/schema/directory';
import { SEED_OWNER_ID, SEED_BANDMATE_ID } from './seed-band-onboarding';
import { withPlatformEnv } from './platform-db';

export const SEED_INSTRUCTOR_ID = 'e2e-instructor-active';
export const SEED_INSTRUCTOR_HEADLINE = 'E2E Guitar and bass lessons';
export const SEED_INSTRUCTOR_CONTACT = 'e2e.teacher@example.com';

/** An application waiting on staff, so the review queue is not empty. */
export const SEED_APPLICANT_ID = 'e2e-instructor-applicant';
export const SEED_APPLICANT_HEADLINE = 'E2E Fiddle lessons';

const ALL_IDS = [SEED_INSTRUCTOR_ID, SEED_APPLICANT_ID];

export async function seedInstructors() {
	await withPlatformEnv(async ({ db }) => {
		await db.delete(instructor).where(inArray(instructor.id, ALL_IDS));

		const now = new Date();

		// Promote the teacher's own listing to public, with a public contact.
		// Both are required for the public route to show them, and the second is
		// the one a fallback bug would silently withhold.
		const [entry] = await db
			.update(directoryEntry)
			.set({
				visibility: 'public',
				contact: { email: SEED_INSTRUCTOR_CONTACT, visibility: 'public' }
			})
			.where(eq(directoryEntry.userId, SEED_OWNER_ID))
			.returning({ id: directoryEntry.id });

		if (entry) {
			await db.delete(directoryTag).where(eq(directoryTag.entryId, entry.id));
			await db
				.insert(directoryTag)
				.values({ entryId: entry.id, kind: 'instrument', value: 'Guitar' });
		}

		await db.insert(instructor).values([
			{
				id: SEED_INSTRUCTOR_ID,
				userId: SEED_OWNER_ID,
				status: 'active',
				headline: SEED_INSTRUCTOR_HEADLINE,
				blurb: 'Electric and acoustic, beginners welcome.',
				ratesNote: '$40 per half hour',
				acceptingStudents: true,
				grantedAt: now,
				statusChangedAt: now,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_APPLICANT_ID,
				userId: SEED_BANDMATE_ID,
				status: 'requested',
				headline: SEED_APPLICANT_HEADLINE,
				applicationNote: 'E2E application note — staff only.',
				acceptingStudents: true,
				createdAt: now,
				updatedAt: now
			}
		]);
	});
}
