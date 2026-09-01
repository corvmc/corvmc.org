/**
 * Teaching records for `instructor.e2e.ts`, into the LOCAL D1 the preview
 * serves.
 *
 * **Its own users, its own directory entries, and it mutates nothing else.** The
 * first version promoted the *band owner's* entry to `public` so the instructor
 * would show on the public listing — breaking the rule `seed-groups.ts` states
 * outright: a spec that mutates a seeded row owns that row. That entry belongs
 * to the band and directory specs, and changing its visibility leaves them
 * asserting on data another fixture rewrote underneath them.
 *
 * Runs **before** `seedDirectoryEntries`, which only claims users that have no
 * entry — "a fixture that needs a public member sets its own entry", as its own
 * note puts it.
 *
 * That ordering is also what keeps `checkpointE2eDatabase()` safe. It must run
 * once every seed's miniflare has exited, and each `withPlatformEnv` call is one
 * more workerd start and dispose; slotting a new one in as the *last* writer
 * narrowed that window until the preview server failed to start outright with
 * `SQLITE_BUSY_RECOVERY`, taking every test in the suite with it.
 *
 * Idempotent: deletes and recreates its rows on every run.
 */
import 'dotenv/config';
import { inArray } from 'drizzle-orm';
import { instructor } from '../../src/lib/server/db/schema/instructor';
import { directoryEntry, directoryTag } from '../../src/lib/server/db/schema/directory';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { scryptHash } from './seed-pay-reservation';
import { withPlatformEnv } from './platform-db';

export const SEED_TEACHER_ID = 'e2e-instructor-teacher';
export const SEED_TEACHER_EMAIL = 'e2e.teacher@example.com';
export const SEED_TEACHER_PASSWORD = 'e2e-password-123';
export const SEED_TEACHER_NAME = 'E2E Teacher';
export const SEED_INSTRUCTOR_HEADLINE = 'E2E Guitar and bass lessons';
export const SEED_TEACHER_CONTACT = 'e2e.lessons@example.com';

/** A second member, waiting on staff, so the review queue is not empty. */
export const SEED_APPLICANT_ID = 'e2e-instructor-applicant-user';
export const SEED_APPLICANT_EMAIL = 'e2e.applicant@example.com';
export const SEED_APPLICANT_PASSWORD = 'e2e-password-123';
export const SEED_APPLICANT_NAME = 'E2E Applicant';
export const SEED_APPLICANT_HEADLINE = 'E2E Fiddle lessons';
export const SEED_APPLICANT_NOTE = 'E2E application note, staff only.';

const USER_IDS = [SEED_TEACHER_ID, SEED_APPLICANT_ID];
const ENTRY_IDS = ['e2e-instructor-entry', 'e2e-applicant-entry'];

export async function seedInstructors() {
	await withPlatformEnv(async ({ db }) => {
		await db.delete(instructor).where(inArray(instructor.userId, USER_IDS));
		await db.delete(directoryTag).where(inArray(directoryTag.entryId, ENTRY_IDS));
		await db.delete(directoryEntry).where(inArray(directoryEntry.id, ENTRY_IDS));
		await db.delete(account).where(inArray(account.userId, USER_IDS));
		await db.delete(user).where(inArray(user.id, USER_IDS));

		const now = new Date();
		const passwordHash = await scryptHash(SEED_TEACHER_PASSWORD);

		for (const [id, name, email] of [
			[SEED_TEACHER_ID, SEED_TEACHER_NAME, SEED_TEACHER_EMAIL],
			[SEED_APPLICANT_ID, SEED_APPLICANT_NAME, SEED_APPLICANT_EMAIL]
		]) {
			await db
				.insert(user)
				.values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now });
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

		// The teacher's listing is public with a public contact — both are gates on
		// the public route, and the second is the one a fallback bug would silently
		// withhold. The applicant's stays `members`, so their absence from the
		// public page is decided by their `requested` status alone.
		await db.insert(directoryEntry).values([
			{
				id: ENTRY_IDS[0],
				userId: SEED_TEACHER_ID,
				name: SEED_TEACHER_NAME,
				visibility: 'public',
				contact: { email: SEED_TEACHER_CONTACT, visibility: 'public' },
				createdAt: now,
				updatedAt: now
			},
			{
				id: ENTRY_IDS[1],
				userId: SEED_APPLICANT_ID,
				name: SEED_APPLICANT_NAME,
				visibility: 'members',
				createdAt: now,
				updatedAt: now
			}
		]);

		await db
			.insert(directoryTag)
			.values({ entryId: ENTRY_IDS[0], kind: 'instrument', value: 'Guitar' });

		await db.insert(instructor).values([
			{
				id: 'e2e-instructor-active',
				userId: SEED_TEACHER_ID,
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
				id: 'e2e-instructor-application',
				userId: SEED_APPLICANT_ID,
				status: 'requested',
				headline: SEED_APPLICANT_HEADLINE,
				applicationNote: SEED_APPLICANT_NOTE,
				acceptingStudents: true,
				createdAt: now,
				updatedAt: now
			}
		]);
	});
}
