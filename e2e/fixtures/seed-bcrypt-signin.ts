/**
 * Seed one member whose password is stored the way Laravel stored it (#623).
 *
 * Their own account, like `seed-password-reset.ts`: a successful sign-in
 * rewrites the hash to scrypt, so sharing one would let Playwright's file
 * ordering decide what `bcrypt-signin.e2e.ts` asserts. Run by `e2e/prepare.ts`.
 */
import 'dotenv/config';
import { inArray } from 'drizzle-orm';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { withPlatformDb } from './platform-db';

export const SEED_BCRYPT_ID = 'e2e-bcrypt-signin-user';
export const SEED_BCRYPT_EMAIL = 'e2e.bcrypt.signin@example.com';
export const SEED_BCRYPT_NAME = 'E2E Legacy Password';
export const SEED_BCRYPT_PASSWORD = 'password';
/**
 * Laravel's own output for that password: `$2y$`, cost 10. Written literally
 * rather than generated, so the fixture keeps testing the format production
 * actually holds even if the hashing library changes.
 */
export const SEED_BCRYPT_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

const ALL_IDS = [SEED_BCRYPT_ID];

export async function seedBcryptSignin(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Delete explicitly — FKs may be disabled on local D1. This also puts the
		// bcrypt hash back after a run that migrated it to scrypt.
		await db.delete(account).where(inArray(account.userId, ALL_IDS));
		await db.delete(user).where(inArray(user.id, ALL_IDS));

		const now = new Date();

		await db.insert(user).values({
			id: SEED_BCRYPT_ID,
			name: SEED_BCRYPT_NAME,
			email: SEED_BCRYPT_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-bcrypt-signin-account',
			accountId: SEED_BCRYPT_ID,
			providerId: 'credential',
			userId: SEED_BCRYPT_ID,
			password: SEED_BCRYPT_HASH,
			createdAt: now,
			updatedAt: now
		});
	});
}
