/**
 * Seed a staff/admin operator plus a small population of plain members into the
 * LOCAL D1 database used by `vite preview`, for the staff-panel e2e tests.
 *
 * Every other fixture seeds a plain member, so before this one no route under
 * `/staff` had any e2e coverage at all — including the user-management screens
 * where two critical defects (unguarded remote endpoints, and profile saves
 * wiping roles) shipped undetected. See docs/reports/staff-user-management-audit.md.
 *
 * Seeds:
 *  - one operator holding both `staff` and `admin`, with a credential account
 *    whose password verifies against the app's scrypt path so the test can log
 *    in through the real better-auth UI;
 *  - one target member holding `member`, used for the role-preservation test;
 *  - enough filler members that `/staff/users` (page size 20) paginates, which
 *    the bulk-selection test needs.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: deletes and recreates the seeded users and their role assignments
 * on every run. Roles themselves are shared with the dev seed, so they are
 * upserted rather than deleted.
 *
 * Mirrors the D1 access pattern in seed-pay-reservation.ts.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { user, account } from '../../src/lib/server/db/schema/authentication';
import { role, modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { scryptHash } from './seed-pay-reservation';
import { withPlatformDb } from './platform-db';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export const SEED_STAFF_EMAIL = 'e2e.staff@example.com';
export const SEED_STAFF_PASSWORD = 'e2e-password-123';
export const SEED_STAFF_ID = 'e2e-staff-user';
export const SEED_STAFF_NAME = 'E2E Staff Operator';

/** The member whose profile the role-preservation test edits. */
export const SEED_TARGET_ID = 'e2e-staff-target';
export const SEED_TARGET_EMAIL = 'e2e.staff.target@example.com';
export const SEED_TARGET_NAME = 'E2E Role Target';
export const SEED_TARGET_ROLE = 'member';

/** `/staff/users` pages at 20 rows; seed past that so page 2 exists. */
export const FILLER_COUNT = 24;
const fillerId = (i: number) => `e2e-staff-filler-${i}`;

const ALL_IDS = [
	SEED_STAFF_ID,
	SEED_TARGET_ID,
	...Array.from({ length: FILLER_COUNT }, (_, i) => fillerId(i))
];

/** Look the role up by name, inserting it if the dev seed hasn't run. */
async function ensureRole(
	db: DrizzleD1Database,
	name: string
): Promise<{ id: number; name: string }> {
	const [existing] = await db
		.select({ id: role.id, name: role.name })
		.from(role)
		.where(eq(role.name, name))
		.limit(1);
	if (existing) return existing;

	const [created] = await db
		.insert(role)
		.values({ name, guardName: 'web' })
		.returning({ id: role.id, name: role.name });
	return created;
}

export async function seedStaffUser(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Clean slate. Delete explicitly (FKs may be disabled on local D1).
		await db.delete(modelHasRole).where(inArray(modelHasRole.userId, ALL_IDS));
		await db.delete(account).where(inArray(account.userId, ALL_IDS));
		await db.delete(user).where(inArray(user.id, ALL_IDS));

		const now = new Date();
		const [staffRole, adminRole, memberRole] = await Promise.all([
			ensureRole(db, 'staff'),
			ensureRole(db, 'admin'),
			ensureRole(db, SEED_TARGET_ROLE)
		]);

		await db.insert(user).values({
			id: SEED_STAFF_ID,
			name: SEED_STAFF_NAME,
			email: SEED_STAFF_EMAIL,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(account).values({
			id: 'e2e-staff-account',
			accountId: SEED_STAFF_ID,
			providerId: 'credential',
			userId: SEED_STAFF_ID,
			password: await scryptHash(SEED_STAFF_PASSWORD),
			createdAt: now,
			updatedAt: now
		});

		// Both roles: requireStaff() accepts either, and holding `admin` keeps the
		// last-admin guard in updateUser from tripping on unrelated edits.
		await db.insert(modelHasRole).values([
			{ roleId: staffRole.id, userId: SEED_STAFF_ID },
			{ roleId: adminRole.id, userId: SEED_STAFF_ID }
		]);

		// The edit target. Created oldest so it never drifts onto page 1 as filler
		// accumulates — the list orders by createdAt DESC.
		await db.insert(user).values({
			id: SEED_TARGET_ID,
			name: SEED_TARGET_NAME,
			email: SEED_TARGET_EMAIL,
			emailVerified: true,
			phone: null,
			createdAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
			updatedAt: now
		});
		await db.insert(modelHasRole).values({ roleId: memberRole.id, userId: SEED_TARGET_ID });

		// Filler members so the list paginates. Inserted in small chunks: D1 caps a
		// statement at 100 bound parameters, and the `user` table binds ~13 per row,
		// so a single 24-row multi-VALUES insert fails with "too many SQL variables".
		const fillers = Array.from({ length: FILLER_COUNT }, (_, i) => ({
			id: fillerId(i),
			name: `E2E Filler ${String(i).padStart(2, '0')}`,
			email: `e2e.filler.${i}@example.com`,
			emailVerified: true,
			createdAt: new Date(now.getTime() - (i + 1) * 60 * 1000),
			updatedAt: now
		}));
		const CHUNK = 5;
		for (let i = 0; i < fillers.length; i += CHUNK) {
			await db.insert(user).values(fillers.slice(i, i + CHUNK));
		}
	});
}
