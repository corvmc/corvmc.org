/**
 * Seed contractor work for the e2e suite.
 *
 * Its own item and unit rather than borrowing `seed-inventory`'s: the test
 * drives a unit out of service and back, and `inventory.e2e.ts` asserts on the
 * status of the units it seeded. Two suites mutating one asset is a flake that
 * only shows up when they interleave.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: deletes and recreates its own rows on every run. Jobs go first —
 * `contractor_job.contractor_id` restricts deletion, so clearing the parent
 * before the child fails outright rather than cascading.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { contractor, contractorJob } from '../../src/lib/server/db/schema/contractor';
import {
	inventoryAsset,
	inventoryItem,
	stockMovement
} from '../../src/lib/server/db/schema/inventory';
import { withPlatformDb } from './platform-db';
import { SEED_CATEGORY_ID } from './seed-inventory';

export const SEED_CONTRACTOR_ID = 'e2e0c04a-0000-4000-8000-000000000001';
export const SEED_CONTRACTOR_NAME = 'E2E Amp Doctor';

/** An archived contractor, so the picker's exclusion has something to exclude. */
export const SEED_ARCHIVED_CONTRACTOR_ID = 'e2e0c04a-0000-4000-8000-000000000002';
export const SEED_ARCHIVED_CONTRACTOR_NAME = 'E2E Retired Tuner';

/** The unit the test sends out and gets back. Starts `in_service`. */
export const SEED_SERVICE_ITEM_ID = 'e2e0c17e-0000-4000-8000-000000000001';
export const SEED_SERVICE_ITEM_NAME = 'E2E Service Amplifier';
export const SEED_SERVICE_ASSET_ID = 'e2e0c455-0000-4000-8000-000000000001';
export const SEED_SERVICE_ASSET_TAG = 'E2E-SVC-01';

export async function seedContractors() {
	await withPlatformDb(async (db) => {
		const contractorIds = [SEED_CONTRACTOR_ID, SEED_ARCHIVED_CONTRACTOR_ID];

		await db.delete(contractorJob).where(inArray(contractorJob.contractorId, contractorIds));
		await db.delete(contractor).where(inArray(contractor.id, contractorIds));
		await db.delete(stockMovement).where(eq(stockMovement.assetId, SEED_SERVICE_ASSET_ID));
		await db.delete(inventoryAsset).where(eq(inventoryAsset.id, SEED_SERVICE_ASSET_ID));
		await db.delete(inventoryItem).where(eq(inventoryItem.id, SEED_SERVICE_ITEM_ID));

		const now = new Date();

		await db.insert(inventoryItem).values({
			id: SEED_SERVICE_ITEM_ID,
			name: SEED_SERVICE_ITEM_NAME,
			categoryId: SEED_CATEGORY_ID,
			kind: 'serialized',
			isLoanable: true,
			createdAt: now,
			updatedAt: now
		});

		await db.insert(inventoryAsset).values({
			id: SEED_SERVICE_ASSET_ID,
			itemId: SEED_SERVICE_ITEM_ID,
			assetTag: SEED_SERVICE_ASSET_TAG,
			condition: 'good',
			status: 'in_service',
			createdAt: now,
			updatedAt: now
		});

		await db.insert(contractor).values([
			{
				id: SEED_CONTRACTOR_ID,
				name: SEED_CONTRACTOR_NAME,
				trade: 'instrument_repair',
				phone: '541-555-0000',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_ARCHIVED_CONTRACTOR_ID,
				name: SEED_ARCHIVED_CONTRACTOR_NAME,
				trade: 'other',
				archivedAt: now,
				createdAt: now,
				updatedAt: now
			}
		]);
	});
}
