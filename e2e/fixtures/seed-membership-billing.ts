/**
 * Seed a sustaining member with a Stripe customer id, so the billing surface on
 * `/member/membership` has somebody to render for.
 *
 * The cards and invoices themselves are **not** seeded here. They live in the
 * fake gateway's in-isolate store, not in D1, and the point of the spec this
 * fixture serves is the round trip that puts one there: no card → add one →
 * default → remove.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 * Idempotent: deletes and recreates the user (and its cascade-owned account
 * rows) on every run.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { withPlatformDb } from './platform-db';
import { scryptHash } from './seed-pay-reservation';

export const SEED_BILLING_EMAIL = 'e2e.billing@example.com';
export const SEED_BILLING_PASSWORD = 'e2e-password-123';
export const SEED_BILLING_USER_ID = 'e2e-billing-user';
export const SEED_BILLING_CUSTOMER_ID = 'cus_seed_e2ebilling';

export async function seedMembershipBilling(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(account).where(eq(account.userId, SEED_BILLING_USER_ID));
		await db.delete(user).where(eq(user.id, SEED_BILLING_USER_ID));

		const now = new Date();
		const periodEnd = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);

		await db.insert(user).values({
			id: SEED_BILLING_USER_ID,
			name: 'E2E Billing',
			email: SEED_BILLING_EMAIL,
			emailVerified: true,
			stripeId: SEED_BILLING_CUSTOMER_ID,
			// The snapshot is what makes them a sustaining member — the legacy role
			// is not maintained by the Stripe flow (see `isSustainingMember`).
			subscription: {
				startedAt: now.toISOString(),
				stripeSubscriptionId: 'sub_seed_e2ebilling',
				hoursPerReset: 8,
				creditsResetAt: periodEnd.toISOString(),
				coveringFees: false,
				cancelAtPeriodEnd: false
			},
			creditFreeHours: 8,
			creditEquipment: 0,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-billing-account',
			accountId: SEED_BILLING_USER_ID,
			providerId: 'credential',
			userId: SEED_BILLING_USER_ID,
			password: await scryptHash(SEED_BILLING_PASSWORD),
			createdAt: now,
			updatedAt: now
		});
	});
}
