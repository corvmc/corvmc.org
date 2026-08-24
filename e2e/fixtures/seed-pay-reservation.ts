/**
 * Seed a known member + a payable (scheduled, balance-due) reservation into the
 * LOCAL D1 database used by `vite preview`, plus a credential account whose
 * password verifies against the app's scrypt path so the e2e test can log in
 * through the real better-auth UI flow.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: deletes and recreates the seeded user (and its cascade-owned
 * reservation/account/session rows) on every run, so reruns start clean.
 *
 * Writes through `withPlatformDb` (getPlatformProxy → drizzle/d1, as in
 * scripts/seed-dev.ts) so it lands in the same D1 file the adapter's emulated
 * bindings later hand to the preview server — the suite's own state directory,
 * not the `.wrangler/state` a dev server uses.
 */
import 'dotenv/config';
import { scrypt, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { withPlatformDb } from './platform-db';

// Inlined copy of the app's scrypt password hashing (src/lib/server/auth.ts).
// Re-implemented here rather than imported because auth.ts pulls in SvelteKit
// virtual modules ($env/dynamic/private, $app/server) that don't resolve under
// the plain tsx runtime this seed runs in. The format must match exactly so the
// app's scryptVerify accepts it: "scrypt:N:r:p:salt_hex:key_hex".
const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, keylen: 64, maxmem: 128 * 16384 * 16 * 2 };

export function scryptHash(password: string): Promise<string> {
	const salt = randomBytes(16);
	const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
	return new Promise((resolve, reject) => {
		scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem }, (err, key) =>
			err
				? reject(err)
				: resolve(`scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${key.toString('hex')}`)
		);
	});
}

export const SEED_MEMBER_EMAIL = 'e2e.payer@example.com';
export const SEED_MEMBER_PASSWORD = 'e2e-password-123';
export const SEED_USER_ID = 'e2e-pay-user';
export const SEED_RESERVATION_ID = 'e2e-pay-reservation';

export async function seedPayReservation(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Clean slate. Deleting the user cascades to its account/session/reservation rows,
		// but delete explicitly to be safe across FK-disabled local D1.
		await db.delete(reservation).where(eq(reservation.id, SEED_RESERVATION_ID));
		await db.delete(account).where(eq(account.userId, SEED_USER_ID));
		await db.delete(user).where(eq(user.id, SEED_USER_ID));

		const now = new Date();
		const passwordHash = await scryptHash(SEED_MEMBER_PASSWORD);

		await db.insert(user).values({
			id: SEED_USER_ID,
			name: 'E2E Payer',
			email: SEED_MEMBER_EMAIL,
			emailVerified: true,
			// No free-hour credits: keeps remainingCents > 0 so the pay page renders
			// the "cover processing fees" checkbox (it's hidden when credits cover it).
			creditFreeHours: 0,
			creditEquipment: 0,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-pay-account',
			accountId: SEED_USER_ID,
			providerId: 'credential',
			userId: SEED_USER_ID,
			password: passwordHash,
			createdAt: now,
			updatedAt: now
		});

		// A 1-hour scheduled, uncommitted reservation. At the default $15/hr rate this
		// is $15.00 due → remainingCents > 0 → checkbox visible, submit says "Pay $X".
		// cashDueCents = null ⇒ credits not yet committed (plain scheduled).
		const startsAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
		startsAt.setUTCHours(20, 0, 0, 0); // ~1pm Pacific
		const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

		await db.insert(reservation).values({
			id: SEED_RESERVATION_ID,
			bookerType: 'user',
			bookerId: SEED_USER_ID,
			createdByUserId: SEED_USER_ID,
			status: 'scheduled',
			startsAt,
			endsAt,
			notes: 'E2E cover-fees payment flow',
			cashDueCents: null,
			createdAt: now,
			updatedAt: now
		});
	});
}
