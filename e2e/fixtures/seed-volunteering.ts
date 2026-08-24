/**
 * Seed the volunteering module for the e2e suite: turn the feature flag on,
 * create two roles (one archived) and a member with pending hour logs.
 *
 * The staff operator comes from seed-staff-user.ts — this fixture only adds the
 * volunteering data that operator reviews, plus a plain member who can log
 * hours through the real UI.
 *
 * Why this exists: the volunteering flows that unit tests cannot reach are all
 * client-server round trips — a review has to drop the row out of the Pending
 * table (SvelteKit's `refresh()` is keyed by argument, and getting that wrong
 * left the approved row visibly stuck in the queue), and a rejection with no
 * reason has to surface a written message rather than raw Zod text.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 *
 * Mirrors the D1 access pattern in seed-staff-user.ts.
 */
import { eq, inArray } from 'drizzle-orm';
import { readLocalDb, withPlatformEnv } from './platform-db';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { role, modelHasRole } from '../../src/lib/server/db/schema/authorization';
import {
	volunteerRole,
	volunteerRoleInterest,
	volunteerProfile,
	volunteerHourLog,
	volunteerCertification,
	memberCertification,
	volunteerRoleCertification,
	volunteerShift,
	volunteerSignup,
	volunteerShiftFeedback
} from '../../src/lib/server/db/schema/volunteer';
import { event } from '../../src/lib/server/db/schema/event';
import { scryptHash } from './seed-pay-reservation';

export const SEED_VOL_MEMBER_ID = 'e2e-vol-member';
export const SEED_VOL_MEMBER_EMAIL = 'e2e.volunteer@example.com';
export const SEED_VOL_MEMBER_PASSWORD = 'e2e-password-123';
export const SEED_VOL_MEMBER_NAME = 'E2E Volunteer';

export const SEED_VOL_ROLE_ID = 'e2e-vol-role-active';
export const SEED_VOL_ROLE_NAME = 'E2E Front Desk';
/**
 * Markdown, so the member page's rendering is exercised rather than assumed.
 * The bolded phrase is deliberately unlike anything in the dev seed — several
 * seeded roles say "No experience needed", and a shared phrase makes the
 * assertion match two cards and trip strict mode.
 */
export const SEED_VOL_ROLE_BOLD_PHRASE = 'E2E training provided on site';

/**
 * Shift defaults, deliberately unlike the form's own fallback of 4 hours and one
 * person — a prefill test that matched the fallback would pass with the wiring
 * cut.
 */
export const SEED_VOL_ROLE_DEFAULT_CAPACITY = 3;
export const SEED_VOL_ROLE_DEFAULT_MINUTES = 240;
export const SEED_VOL_GATED_DEFAULT_CAPACITY = 7;
export const SEED_VOL_ROLE_DESCRIPTION = `Cover the door during open hours.\n\n**${SEED_VOL_ROLE_BOLD_PHRASE}** — we will show you the ropes.`;

/** A already-reviewed rejection, so the member-side rendering of the reason can
 * be asserted without juggling two logins in one browser context. */
export const SEED_VOL_REJECTED_REASON = 'E2E: this looks like a duplicate of the same shift.';

export const SEED_VOL_ARCHIVED_ROLE_ID = 'e2e-vol-role-archived';
export const SEED_VOL_ARCHIVED_ROLE_NAME = 'E2E Retired Role';

/** Two pending logs: one to approve, one to reject. */
export const SEED_VOL_LOG_APPROVE_ID = 'e2e-vol-log-approve';
export const SEED_VOL_LOG_REJECT_ID = 'e2e-vol-log-reject';
export const SEED_VOL_LOG_APPROVE_DESC = 'E2E ran sound for the open mic';
export const SEED_VOL_LOG_REJECT_DESC = 'E2E duplicate of the same shift';

/** Filed against the archived role, so reports must still resolve it. */
export const SEED_VOL_LOG_ARCHIVED_ID = 'e2e-vol-log-archived';

export const SEED_VOL_LOG_REJECTED_ID = 'e2e-vol-log-already-rejected';
export const SEED_VOL_LOG_REJECTED_DESC = 'E2E already-rejected entry';

// --- Phase 2: certifications and shifts -----------------------------------

export const SEED_VOL_CERT_ID = 'e2e-vol-cert';
export const SEED_VOL_CERT_NAME = 'E2E Sound Desk Clearance';

/** Requires the clearance above; the seeded member does NOT hold it. */
export const SEED_VOL_GATED_ROLE_ID = 'e2e-vol-role-gated';
export const SEED_VOL_GATED_ROLE_NAME = 'E2E Sound Desk';

/** Open, ungated, one place — the happy-path claim. */
export const SEED_VOL_SHIFT_OPEN_ID = 'e2e-vol-shift-open';
export const SEED_VOL_SHIFT_OPEN_NOTE = 'E2E meet at the side door';

/** Gated by the clearance the member lacks — the refusal must say why. */
export const SEED_VOL_SHIFT_GATED_ID = 'e2e-vol-shift-gated';

/** Capacity 1, already taken by somebody else. */
export const SEED_VOL_SHIFT_FULL_ID = 'e2e-vol-shift-full';
export const SEED_VOL_SHIFT_FULL_NOTE = 'E2E already spoken for';
export const SEED_VOL_OTHER_MEMBER_ID = 'e2e-vol-other-member';

/**
 * A member with an account but no volunteer profile, for the onboarding gate.
 * Kept separate from SEED_VOL_MEMBER_ID, which every pre-existing member test
 * expects to land straight on /member/volunteer.
 */
export const SEED_VOL_NEW_MEMBER_ID = 'e2e-vol-new-member';
export const SEED_VOL_NEW_MEMBER_EMAIL = 'e2e.new.volunteer@example.com';
export const SEED_VOL_NEW_MEMBER_NAME = 'E2E Newcomer Volunteer';

/**
 * Also profile-less: the minor path creates the profile through the real form
 * by answering "no", so the staff approval test exercises the actual write
 * rather than a hand-seeded `blocked` row.
 */
export const SEED_VOL_MINOR_ID = 'e2e-vol-minor';
export const SEED_VOL_MINOR_EMAIL = 'e2e.minor.volunteer@example.com';
export const SEED_VOL_MINOR_NAME = 'E2E Minor Volunteer';
export const SEED_VOL_MINOR_FIRST = 'Robin';
export const SEED_VOL_MINOR_LAST = 'Okonkwo';

/**
 * A second minor, already blocked when the fixture lands, for the staff
 * approval path. Separate from SEED_VOL_MINOR_ID so neither test depends on the
 * other having run — the blocking test needs a member with no profile, and the
 * approval test needs one with a blocked profile.
 */
export const SEED_VOL_BLOCKED_MINOR_ID = 'e2e-vol-blocked-minor';
export const SEED_VOL_BLOCKED_MINOR_EMAIL = 'e2e.blocked.volunteer@example.com';
export const SEED_VOL_BLOCKED_MINOR_NAME = 'E2E Blocked Volunteer';
export const SEED_VOL_BLOCKED_MINOR_FIRST = 'Jess';
export const SEED_VOL_BLOCKED_MINOR_LAST = 'Almeida';

/** Completed yesterday by the member under test — the feedback survey's subject. */
export const SEED_VOL_SHIFT_DONE_ID = 'e2e-vol-shift-done';
export const SEED_VOL_SIGNUP_DONE_ID = 'e2e-vol-signup-done';

/**
 * A published show, and a shift attached to it.
 *
 * Kept off SEED_VOL_SHIFT_OPEN_ID on purpose: that one is the member board's
 * happy-path claim, and hanging an event title on its card would change the
 * text every existing claim assertion reads. The link is worth testing on a
 * shift nothing else depends on.
 */
export const SEED_VOL_EVENT_ID = 'e2e-vol-event';
export const SEED_VOL_EVENT_TITLE = 'E2E Sludgefest';
export const SEED_VOL_SHIFT_EVENT_ID = 'e2e-vol-shift-event';

const SHIFT_IDS = [
	SEED_VOL_SHIFT_OPEN_ID,
	SEED_VOL_SHIFT_GATED_ID,
	SEED_VOL_SHIFT_FULL_ID,
	SEED_VOL_SHIFT_DONE_ID,
	SEED_VOL_SHIFT_EVENT_ID
];

/** Days out, at a fixed hour, so the board always has a future shift to claim. */
function daysFromNow(days: number, hourUtc: number): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setUTCHours(hourUtc, 0, 0, 0);
	return d;
}

const LOG_IDS = [
	SEED_VOL_LOG_APPROVE_ID,
	SEED_VOL_LOG_REJECT_ID,
	SEED_VOL_LOG_ARCHIVED_ID,
	SEED_VOL_LOG_REJECTED_ID
];
const ROLE_IDS = [SEED_VOL_ROLE_ID, SEED_VOL_ARCHIVED_ROLE_ID];

/** Every role this fixture owns — what a shift left behind by the UI hangs off. */
const ALL_ROLE_IDS = [...ROLE_IDS, SEED_VOL_GATED_ROLE_ID];

/** Members added by this fixture on top of SEED_VOL_MEMBER_ID. */
const EXTRA_MEMBER_IDS = [SEED_VOL_NEW_MEMBER_ID, SEED_VOL_MINOR_ID, SEED_VOL_BLOCKED_MINOR_ID];
const MEMBER_IDS = [SEED_VOL_MEMBER_ID, SEED_VOL_OTHER_MEMBER_ID, ...EXTRA_MEMBER_IDS];

/** Noon club time, N days back — matches how the service anchors workedOn. */
function workedOnDaysAgo(days: number): Date {
	const d = new Date();
	d.setDate(d.getDate() - days);
	d.setUTCHours(19, 0, 0, 0);
	return d;
}

export async function seedVolunteering(): Promise<void> {
	await withPlatformEnv(async ({ db, env }) => {
		const kv = (env as { KV: KVNamespace }).KV;

		// The flag lives in KV, not D1 — without this every volunteer route 404s.
		await kv.put('site-config:feature.volunteering', JSON.stringify(true));

		// Child before parent: the role FK is ON DELETE RESTRICT, and signups and
		// held certifications both point at rows recreated below.
		//
		// Shifts are collected by *role* rather than taken from SHIFT_IDS, because
		// the suite creates shifts through the real UI and those carry random ids.
		// Deleting only the known ones left an orphan pointing at a seeded role,
		// and the next run failed on the ON DELETE RESTRICT — a red suite that had
		// nothing to do with the code under test.
		const staleShifts = await db
			.select({ id: volunteerShift.id })
			.from(volunteerShift)
			.where(inArray(volunteerShift.volunteerRoleId, ALL_ROLE_IDS));
		const shiftIds = [...new Set([...SHIFT_IDS, ...staleShifts.map((r) => r.id)])];

		const staleSignups = await db
			.select({ id: volunteerSignup.id })
			.from(volunteerSignup)
			.where(inArray(volunteerSignup.shiftId, shiftIds));

		if (staleSignups.length > 0) {
			await db.delete(volunteerShiftFeedback).where(
				inArray(
					volunteerShiftFeedback.signupId,
					staleSignups.map((r) => r.id)
				)
			);
		}
		await db.delete(volunteerSignup).where(inArray(volunteerSignup.shiftId, shiftIds));
		await db.delete(volunteerShift).where(inArray(volunteerShift.id, shiftIds));
		// After the shifts: the FK is ON DELETE SET NULL, so deleting the event
		// first would silently unlink the very row the linked-shift tests assert on.
		await db.delete(event).where(eq(event.id, SEED_VOL_EVENT_ID));
		await db
			.delete(volunteerRoleCertification)
			.where(eq(volunteerRoleCertification.certificationId, SEED_VOL_CERT_ID));
		await db
			.delete(memberCertification)
			.where(eq(memberCertification.certificationId, SEED_VOL_CERT_ID));
		await db.delete(volunteerCertification).where(eq(volunteerCertification.id, SEED_VOL_CERT_ID));
		await db.delete(user).where(eq(user.id, SEED_VOL_OTHER_MEMBER_ID));
		// Profiles cascade from `user`, but the two extra members below are deleted
		// by id and SEED_VOL_MEMBER_ID's profile has to go before its user row.
		await db.delete(volunteerProfile).where(inArray(volunteerProfile.userId, MEMBER_IDS));
		await db.delete(account).where(inArray(account.userId, EXTRA_MEMBER_IDS));
		await db.delete(modelHasRole).where(inArray(modelHasRole.userId, EXTRA_MEMBER_IDS));
		await db.delete(user).where(inArray(user.id, EXTRA_MEMBER_IDS));
		await db.delete(volunteerRoleInterest).where(inArray(volunteerRoleInterest.userId, MEMBER_IDS));
		await db.delete(volunteerHourLog).where(inArray(volunteerHourLog.id, LOG_IDS));
		await db.delete(volunteerHourLog).where(eq(volunteerHourLog.userId, SEED_VOL_MEMBER_ID));
		await db.delete(volunteerRole).where(inArray(volunteerRole.id, ROLE_IDS));
		await db.delete(volunteerRole).where(eq(volunteerRole.id, SEED_VOL_GATED_ROLE_ID));
		await db.delete(modelHasRole).where(eq(modelHasRole.userId, SEED_VOL_MEMBER_ID));
		await db.delete(account).where(eq(account.userId, SEED_VOL_MEMBER_ID));
		await db.delete(user).where(eq(user.id, SEED_VOL_MEMBER_ID));

		const now = new Date();

		const [memberRole] = await db
			.select({ id: role.id })
			.from(role)
			.where(eq(role.name, 'member'))
			.limit(1);

		await db.insert(user).values({
			id: SEED_VOL_MEMBER_ID,
			name: SEED_VOL_MEMBER_NAME,
			email: SEED_VOL_MEMBER_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-vol-account',
			accountId: SEED_VOL_MEMBER_ID,
			providerId: 'credential',
			userId: SEED_VOL_MEMBER_ID,
			password: await scryptHash(SEED_VOL_MEMBER_PASSWORD),
			createdAt: now,
			updatedAt: now
		});

		if (memberRole) {
			await db.insert(modelHasRole).values({ roleId: memberRole.id, userId: SEED_VOL_MEMBER_ID });
		}

		await db.insert(volunteerRole).values([
			{
				id: SEED_VOL_ROLE_ID,
				name: SEED_VOL_ROLE_NAME,
				description: SEED_VOL_ROLE_DESCRIPTION,
				displayOrder: 0,
				isActive: true,
				defaultDurationMinutes: SEED_VOL_ROLE_DEFAULT_MINUTES,
				defaultCapacity: SEED_VOL_ROLE_DEFAULT_CAPACITY,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VOL_ARCHIVED_ROLE_ID,
				name: SEED_VOL_ARCHIVED_ROLE_NAME,
				description: 'On hiatus.',
				displayOrder: 1,
				isActive: false,
				createdAt: now,
				updatedAt: now
			}
		]);

		// --- Onboarding ----------------------------------------------------
		// The member under test is already onboarded. Without this every
		// pre-existing member test would be redirected to /member/volunteer/start
		// before its page rendered.
		await db.insert(volunteerProfile).values({
			id: 'e2e-vol-profile',
			userId: SEED_VOL_MEMBER_ID,
			firstName: 'E2E',
			lastName: 'Volunteer',
			isAdult: true,
			status: 'active',
			createdAt: now,
			updatedAt: now
		});

		// Two more members who have *not* onboarded — one walks the adult path,
		// one answers "under 18" and lands in the staff queue. Both get a real
		// credential account so the tests log in the same way as everybody else.
		for (const [id, name, email, accountId] of [
			[
				SEED_VOL_NEW_MEMBER_ID,
				SEED_VOL_NEW_MEMBER_NAME,
				SEED_VOL_NEW_MEMBER_EMAIL,
				'e2e-vol-new-account'
			],
			[SEED_VOL_MINOR_ID, SEED_VOL_MINOR_NAME, SEED_VOL_MINOR_EMAIL, 'e2e-vol-minor-account'],
			[
				SEED_VOL_BLOCKED_MINOR_ID,
				SEED_VOL_BLOCKED_MINOR_NAME,
				SEED_VOL_BLOCKED_MINOR_EMAIL,
				'e2e-vol-blocked-account'
			]
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
				id: accountId,
				accountId: id,
				providerId: 'credential',
				userId: id,
				password: await scryptHash(SEED_VOL_MEMBER_PASSWORD),
				createdAt: now,
				updatedAt: now
			});

			if (memberRole) {
				await db.insert(modelHasRole).values({ roleId: memberRole.id, userId: id });
			}
		}

		// Already in the staff queue when the suite starts.
		await db.insert(volunteerProfile).values({
			id: 'e2e-vol-blocked-profile',
			userId: SEED_VOL_BLOCKED_MINOR_ID,
			firstName: SEED_VOL_BLOCKED_MINOR_FIRST,
			lastName: SEED_VOL_BLOCKED_MINOR_LAST,
			isAdult: false,
			status: 'blocked',
			createdAt: now,
			updatedAt: now
		});

		// --- Phase 2 -------------------------------------------------------
		// A second member, so the "full" shift is taken by somebody who isn't the
		// member under test.
		await db.insert(user).values({
			id: SEED_VOL_OTHER_MEMBER_ID,
			name: 'E2E Other Volunteer',
			email: 'e2e.other.volunteer@example.com',
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(volunteerCertification).values({
			id: SEED_VOL_CERT_ID,
			name: SEED_VOL_CERT_NAME,
			description: 'Ask a staff engineer to sign you off.',
			displayOrder: 0,
			isActive: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(volunteerRole).values({
			id: SEED_VOL_GATED_ROLE_ID,
			name: SEED_VOL_GATED_ROLE_NAME,
			description: 'Run the desk.',
			displayOrder: 2,
			isActive: true,
			defaultCapacity: SEED_VOL_GATED_DEFAULT_CAPACITY,
			createdAt: now,
			updatedAt: now
		});

		// The gate itself. The member under test deliberately holds nothing, so
		// the refusal path is the default rather than something a test sets up.
		await db.insert(volunteerRoleCertification).values({
			volunteerRoleId: SEED_VOL_GATED_ROLE_ID,
			certificationId: SEED_VOL_CERT_ID
		});

		// Standing interest in both roles, so the staff role detail page has someone
		// to list. The gated role is the useful half: the member is interested but
		// holds nothing, which is exactly the "interested but not rosterable" case
		// the readiness column exists to surface.
		await db.insert(volunteerRoleInterest).values([
			{
				id: 'e2e-vol-interest-active',
				userId: SEED_VOL_MEMBER_ID,
				volunteerRoleId: SEED_VOL_ROLE_ID,
				createdAt: now
			},
			{
				id: 'e2e-vol-interest-gated',
				userId: SEED_VOL_MEMBER_ID,
				volunteerRoleId: SEED_VOL_GATED_ROLE_ID,
				createdAt: now
			}
		]);

		await db.insert(volunteerShift).values([
			{
				id: SEED_VOL_SHIFT_OPEN_ID,
				volunteerRoleId: SEED_VOL_ROLE_ID,
				startsAt: daysFromNow(3, 2),
				endsAt: daysFromNow(3, 6),
				capacity: 1,
				notes: SEED_VOL_SHIFT_OPEN_NOTE,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VOL_SHIFT_GATED_ID,
				volunteerRoleId: SEED_VOL_GATED_ROLE_ID,
				startsAt: daysFromNow(4, 2),
				endsAt: daysFromNow(4, 6),
				capacity: 1,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VOL_SHIFT_FULL_ID,
				volunteerRoleId: SEED_VOL_ROLE_ID,
				startsAt: daysFromNow(5, 2),
				endsAt: daysFromNow(5, 6),
				capacity: 1,
				notes: SEED_VOL_SHIFT_FULL_NOTE,
				createdAt: now,
				updatedAt: now
			}
		]);

		// A published show with one shift on it. Both the staff event page's
		// Volunteer Shifts card and the shift detail page's Event fact read this.
		await db.insert(event).values({
			id: SEED_VOL_EVENT_ID,
			title: SEED_VOL_EVENT_TITLE,
			description: 'E2E fixture show.',
			startsAt: daysFromNow(6, 2),
			endsAt: daysFromNow(6, 6),
			doorsAt: daysFromNow(6, 1),
			status: 'published',
			publishedAt: now,
			source: 'cmc',
			createdByUserId: SEED_VOL_MEMBER_ID,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(volunteerShift).values({
			id: SEED_VOL_SHIFT_EVENT_ID,
			volunteerRoleId: SEED_VOL_ROLE_ID,
			eventId: SEED_VOL_EVENT_ID,
			startsAt: daysFromNow(6, 1),
			endsAt: daysFromNow(6, 6),
			capacity: 2,
			createdAt: now,
			updatedAt: now
		});

		// Ended yesterday, completed, unreviewed — exactly what the day-after
		// survey cron would have asked about.
		await db.insert(volunteerShift).values({
			id: SEED_VOL_SHIFT_DONE_ID,
			volunteerRoleId: SEED_VOL_ROLE_ID,
			startsAt: workedOnDaysAgo(1),
			endsAt: new Date(workedOnDaysAgo(1).getTime() + 4 * 3_600_000),
			capacity: 1,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(volunteerSignup).values({
			id: SEED_VOL_SIGNUP_DONE_ID,
			shiftId: SEED_VOL_SHIFT_DONE_ID,
			userId: SEED_VOL_MEMBER_ID,
			status: 'completed',
			claimedAt: now,
			confirmedAt: now,
			completedAt: now,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(volunteerSignup).values({
			id: 'e2e-vol-signup-other',
			shiftId: SEED_VOL_SHIFT_FULL_ID,
			userId: SEED_VOL_OTHER_MEMBER_ID,
			status: 'confirmed',
			claimedAt: now,
			confirmedAt: now,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(volunteerHourLog).values([
			{
				id: SEED_VOL_LOG_APPROVE_ID,
				userId: SEED_VOL_MEMBER_ID,
				volunteerRoleId: SEED_VOL_ROLE_ID,
				workedOn: workedOnDaysAgo(2),
				minutes: 120,
				description: SEED_VOL_LOG_APPROVE_DESC,
				status: 'pending',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VOL_LOG_REJECT_ID,
				userId: SEED_VOL_MEMBER_ID,
				volunteerRoleId: SEED_VOL_ROLE_ID,
				workedOn: workedOnDaysAgo(3),
				minutes: 90,
				description: SEED_VOL_LOG_REJECT_DESC,
				status: 'pending',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VOL_LOG_ARCHIVED_ID,
				userId: SEED_VOL_MEMBER_ID,
				volunteerRoleId: SEED_VOL_ARCHIVED_ROLE_ID,
				workedOn: workedOnDaysAgo(10),
				minutes: 60,
				description: 'E2E work under a since-retired role',
				status: 'approved',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_VOL_LOG_REJECTED_ID,
				userId: SEED_VOL_MEMBER_ID,
				volunteerRoleId: SEED_VOL_ROLE_ID,
				workedOn: workedOnDaysAgo(5),
				minutes: 60,
				description: SEED_VOL_LOG_REJECTED_DESC,
				status: 'rejected',
				reviewNotes: SEED_VOL_REJECTED_REASON,
				reviewedAt: now,
				createdAt: now,
				updatedAt: now
			}
		]);
	});
}

/** The member's signup status on a shift, for assertions the UI cannot make. */
export async function readSignupStatus(shiftId: string): Promise<string | null> {
	return readLocalDb(async (db) => {
		const [row] = await db
			.select({ status: volunteerSignup.status })
			.from(volunteerSignup)
			.where(eq(volunteerSignup.shiftId, shiftId))
			.limit(1);
		return row?.status ?? null;
	});
}

/**
 * The event a shift is attached to, or null.
 *
 * Read from the database rather than the page because the failure this guards
 * is invisible on screen: a cleared picker that posts no field at all leaves the
 * old `event_id` in place while the form reports success, and the page only
 * shows the stale value again after a reload.
 */
export async function readShiftEventId(shiftId: string): Promise<string | null> {
	return readLocalDb(async (db) => {
		const [row] = await db
			.select({ eventId: volunteerShift.eventId })
			.from(volunteerShift)
			.where(eq(volunteerShift.id, shiftId))
			.limit(1);
		return row?.eventId ?? null;
	});
}

/** Read back what the app wrote, for assertions the UI cannot make. */
export async function readVolunteerState(): Promise<{
	approveLogStatus: string | null;
	creditRowCount: number;
}> {
	const { creditTransaction } = await import('../../src/lib/server/db/schema/finance');

	return readLocalDb(async (db) => {
		const [log] = await db
			.select({ status: volunteerHourLog.status })
			.from(volunteerHourLog)
			.where(eq(volunteerHourLog.id, SEED_VOL_LOG_APPROVE_ID))
			.limit(1);

		const rows = await db
			.select({ id: creditTransaction.id })
			.from(creditTransaction)
			.where(eq(creditTransaction.userId, SEED_VOL_MEMBER_ID));

		return { approveLogStatus: log?.status ?? null, creditRowCount: rows.length };
	});
}
