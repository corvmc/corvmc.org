/**
 * Seed one member who exists only to have their password reset.
 *
 * The password-reset spec changes a credential, and a credential is the one
 * piece of seeded state that ~104 other sign-ins depend on. Sharing an account
 * with them would make Playwright's file ordering decide whether they pass, so
 * this member is used by nothing else.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: deletes and recreates the user and their credential on every run,
 * which also puts the password back after a run that changed it. It also clears
 * the request's KV counters — see `resetPasswordResetRateLimits` below.
 *
 * Mirrors the D1 access pattern in seed-staff-user.ts.
 */
import 'dotenv/config';
import { inArray } from 'drizzle-orm';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { scryptHash } from './seed-pay-reservation';
import { withPlatformDb, withPlatformEnv } from './platform-db';

export const SEED_RESET_ID = 'e2e-password-reset-user';
export const SEED_RESET_EMAIL = 'e2e.password.reset@example.com';
export const SEED_RESET_NAME = 'E2E Reset Subject';
export const SEED_RESET_PASSWORD = 'e2e-password-123';
/** What the spec sets it to. Must be at least the 8 characters the form asks for. */
export const SEED_RESET_NEW_PASSWORD = 'e2e-new-password-456';

const ALL_IDS = [SEED_RESET_ID];

export async function seedPasswordReset(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Delete explicitly — FKs may be disabled on local D1.
		await db.delete(account).where(inArray(account.userId, ALL_IDS));
		await db.delete(user).where(inArray(user.id, ALL_IDS));

		const now = new Date();

		await db.insert(user).values({
			id: SEED_RESET_ID,
			name: SEED_RESET_NAME,
			email: SEED_RESET_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-password-reset-account',
			accountId: SEED_RESET_ID,
			providerId: 'credential',
			userId: SEED_RESET_ID,
			password: await scryptHash(SEED_RESET_PASSWORD),
			createdAt: now,
			updatedAt: now
		});
	});

	await resetPasswordResetRateLimits();
}

/**
 * Clear the reset request's KV rate-limit counters.
 *
 * `requestPasswordReset` allows 3 requests per address and 10 per source IP an
 * hour, and KV survives between runs in the suite's state directory. Under
 * `vite preview` nothing sets CF-Connecting-IP, so every request in the suite
 * shares the `unknown` bucket — which the fourth run of this spec would find
 * already spent.
 *
 * The failure would be silent by design: a throttled request returns the same
 * neutral success as an accepted one, so the symptom is a reset link that never
 * arrives, with nothing anywhere saying why.
 */
async function resetPasswordResetRateLimits(): Promise<void> {
	await withPlatformEnv(async ({ env }) => {
		const kv = env.KV as KVNamespace | undefined;
		if (!kv) return;
		await kv.delete(`rate-limit:pw-reset:email:${SEED_RESET_EMAIL}`);
		await kv.delete('rate-limit:pw-reset:ip:unknown');
	});
}
