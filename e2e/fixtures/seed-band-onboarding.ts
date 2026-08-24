/**
 * Seed a band owner + three bands (public, hidden, members-only) into the LOCAL
 * D1 database used by `vite preview`, for the band directory onboarding e2e
 * tests: the band profile edit page regression (effect_update_depth_exceeded),
 * the hometown/foundedYear save round-trip, and the directoryVisibility gate on
 * public band detail pages.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: deletes and recreates the seeded user and bands on every run.
 * Mirrors the D1 access pattern in seed-pay-reservation.ts.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { band, bandMember, bandSlugHistory } from '../../src/lib/server/db/schema/band';
import { scryptHash } from './seed-pay-reservation';
import { withPlatformEnv } from './platform-db';

export const SEED_OWNER_EMAIL = 'e2e.band.owner@example.com';
export const SEED_OWNER_PASSWORD = 'e2e-password-123';
export const SEED_OWNER_ID = 'e2e-band-owner';

// A second, non-admin member of the members band. Needed to prove the band
// reservation cancel policy from the outside: a bandmate who didn't book a
// session must not be offered a Cancel button for it.
export const SEED_BANDMATE_EMAIL = 'e2e.band.mate@example.com';
export const SEED_BANDMATE_PASSWORD = 'e2e-password-123';
export const SEED_BANDMATE_ID = 'e2e-band-mate';

export const SEED_PUBLIC_BAND_ID = 'e2e-band-public';
export const SEED_PUBLIC_BAND_SLUG = 'e2e-public-band';
export const SEED_PUBLIC_BAND_NAME = 'E2E Public Band';
export const SEED_PUBLIC_BAND_HOMETOWN = 'Corvallis, OR';
export const SEED_PUBLIC_BAND_FOUNDED = '2019';
/** An address this band released, which should still forward to the one above. */
export const SEED_PUBLIC_BAND_OLD_SLUG = 'e2e-public-band-former';

export const SEED_HIDDEN_BAND_ID = 'e2e-band-hidden';
export const SEED_HIDDEN_BAND_SLUG = 'e2e-hidden-band';

export const SEED_MEMBERS_BAND_ID = 'e2e-band-members';
export const SEED_MEMBERS_BAND_SLUG = 'e2e-members-band';
export const SEED_MEMBERS_BAND_NAME = 'E2E Members Band';

/** Premium tier, so its subdomain serves the microsite instead of redirecting. */
export const SEED_PREMIUM_BAND_ID = 'e2e-band-premium';
export const SEED_PREMIUM_BAND_SLUG = 'e2e-premium-band';
export const SEED_PREMIUM_BAND_NAME = 'E2E Premium Band';

/**
 * Exists to be renamed. The address-change test moves this band's slug, so it
 * must not be one the other subdomain tests depend on — Playwright ordering
 * would otherwise decide whether they pass.
 */
export const SEED_RENAME_BAND_ID = 'e2e-band-rename';
export const SEED_RENAME_BAND_SLUG = 'e2e-rename-band';
export const SEED_RENAME_BAND_NAME = 'E2E Rename Band';

/**
 * Exists to be retitled. Same reasoning as the band above, for the other kind of
 * rename: the profile-edit test writes a new *name* and leaves it there, so it
 * must not be a band another spec asserts a name on. It used to borrow the
 * public band and put the name back afterwards, and any run where that restore
 * did not land took three `band-subdomain.e2e.ts` assertions with it — a
 * failure with nothing in that file to explain it.
 */
export const SEED_RETITLE_BAND_ID = 'e2e-band-retitle';
export const SEED_RETITLE_BAND_SLUG = 'e2e-retitle-band';
export const SEED_RETITLE_BAND_NAME = 'E2E Retitle Band';

const BAND_IDS = [
	SEED_PUBLIC_BAND_ID,
	SEED_HIDDEN_BAND_ID,
	SEED_MEMBERS_BAND_ID,
	SEED_PREMIUM_BAND_ID,
	SEED_RENAME_BAND_ID,
	SEED_RETITLE_BAND_ID
];

export async function seedBandOnboarding(): Promise<void> {
	await withPlatformEnv(async ({ db, env }) => {
		// The address change is capped at 3 per 30 days, and the local KV survives
		// between preview runs — without this, the fourth `pnpm test:e2e` on one
		// machine would fail the address test for reasons that look nothing like
		// the cause.
		await (env as { KV?: KVNamespace }).KV?.delete(`rate-limit:band-slug:${SEED_RENAME_BAND_ID}`);

		// Clean slate. Delete explicitly (FKs may be disabled on local D1).
		for (const bandId of BAND_IDS) {
			await db.delete(bandMember).where(eq(bandMember.bandId, bandId));
			await db.delete(bandSlugHistory).where(eq(bandSlugHistory.bandId, bandId));
			await db.delete(band).where(eq(band.id, bandId));
		}
		for (const userId of [SEED_OWNER_ID, SEED_BANDMATE_ID]) {
			await db.delete(account).where(eq(account.userId, userId));
			await db.delete(user).where(eq(user.id, userId));
		}

		const now = new Date();
		const passwordHash = await scryptHash(SEED_OWNER_PASSWORD);

		await db.insert(user).values({
			id: SEED_OWNER_ID,
			name: 'E2E Band Owner',
			email: SEED_OWNER_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-band-owner-account',
			accountId: SEED_OWNER_ID,
			providerId: 'credential',
			userId: SEED_OWNER_ID,
			password: passwordHash,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(user).values({
			id: SEED_BANDMATE_ID,
			name: 'E2E Bandmate',
			email: SEED_BANDMATE_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-band-mate-account',
			accountId: SEED_BANDMATE_ID,
			providerId: 'credential',
			userId: SEED_BANDMATE_ID,
			password: passwordHash,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(band).values([
			{
				id: SEED_PUBLIC_BAND_ID,
				name: SEED_PUBLIC_BAND_NAME,
				slug: SEED_PUBLIC_BAND_SLUG,
				// Plain-text (non-HTML) bio: the shape every band created through the
				// create-band modal has, and the shape that fed the RichTextEditor
				// reconcile churn in the edit-page crash.
				bio: 'Plain text bio seeded for the edit page regression test.',
				ownerId: SEED_OWNER_ID,
				hometown: SEED_PUBLIC_BAND_HOMETOWN,
				foundedYear: SEED_PUBLIC_BAND_FOUNDED,
				directoryVisibility: 'public',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_HIDDEN_BAND_ID,
				name: 'E2E Hidden Band',
				slug: SEED_HIDDEN_BAND_SLUG,
				bio: 'This band opted out of the directory entirely.',
				ownerId: SEED_OWNER_ID,
				directoryVisibility: 'hidden',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_MEMBERS_BAND_ID,
				name: SEED_MEMBERS_BAND_NAME,
				slug: SEED_MEMBERS_BAND_SLUG,
				bio: 'Visible to logged-in members only.',
				ownerId: SEED_OWNER_ID,
				directoryVisibility: 'members',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_PREMIUM_BAND_ID,
				name: SEED_PREMIUM_BAND_NAME,
				slug: SEED_PREMIUM_BAND_SLUG,
				bio: 'Premium tier, so its subdomain serves a band site.',
				ownerId: SEED_OWNER_ID,
				tier: 'premium',
				directoryVisibility: 'public',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_RENAME_BAND_ID,
				name: SEED_RENAME_BAND_NAME,
				slug: SEED_RENAME_BAND_SLUG,
				bio: 'Disposable: the address-change test moves this band.',
				ownerId: SEED_OWNER_ID,
				directoryVisibility: 'public',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_RETITLE_BAND_ID,
				name: SEED_RETITLE_BAND_NAME,
				slug: SEED_RETITLE_BAND_SLUG,
				// Plain-text bio, like the public band: the rename regression rode in
				// on the edit page, whose RichTextEditor churn needs this shape.
				bio: 'Disposable: the profile-edit test renames this band.',
				ownerId: SEED_OWNER_ID,
				directoryVisibility: 'public',
				createdAt: now,
				updatedAt: now
			}
		]);

		await db.insert(bandSlugHistory).values({
			id: 'e2e-band-public-old-slug',
			slug: SEED_PUBLIC_BAND_OLD_SLUG,
			bandId: SEED_PUBLIC_BAND_ID,
			createdAt: now
		});

		await db.insert(bandMember).values(
			BAND_IDS.map((bandId) => ({
				id: `${bandId}-owner`,
				bandId,
				userId: SEED_OWNER_ID,
				role: 'owner' as const,
				status: 'active' as const,
				createdAt: now
			}))
		);

		// A plain member — not an admin — of one band, so a test can check what a
		// bandmate is and isn't offered.
		await db.insert(bandMember).values({
			id: `${SEED_MEMBERS_BAND_ID}-mate`,
			bandId: SEED_MEMBERS_BAND_ID,
			userId: SEED_BANDMATE_ID,
			role: 'member' as const,
			status: 'active' as const,
			createdAt: now
		});
	});
}
