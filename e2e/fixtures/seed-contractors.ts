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
 * `contractor_job.contractor_id` and `.work_order_id` restrict deletion, so
 * clearing a parent before the child fails outright rather than cascading. The
 * work orders a run's jobs were made with go after them.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { contractor, contractorJob } from '../../src/lib/server/db/schema/contractor';
import {
	inventoryAsset,
	inventoryItem,
	stockMovement
} from '../../src/lib/server/db/schema/inventory';
import { workOrder } from '../../src/lib/server/db/schema/volunteer';
import { withPlatformDb } from './platform-db';
import { SEED_CATEGORY_ID } from './seed-inventory';

export const SEED_CONTRACTOR_ID = 'e2e0c04a-0000-4000-8000-000000000001';
export const SEED_CONTRACTOR_NAME = 'E2E Amp Doctor';

/** An archived contractor, so the picker's exclusion has something to exclude. */
export const SEED_ARCHIVED_CONTRACTOR_ID = 'e2e0c04a-0000-4000-8000-000000000002';
export const SEED_ARCHIVED_CONTRACTOR_NAME = 'E2E Retired Tuner';

export const SEED_SERVICE_ITEM_ID = 'e2e0c17e-0000-4000-8000-000000000001';
export const SEED_SERVICE_ITEM_NAME = 'E2E Service Amplifier';

/**
 * One unit per attempt, all `in_service`: an attempt that fails after booking
 * has spent its unit, and a test may not write to reset it, so a CI retry
 * (`retries: 2`) takes the next one rather than inheriting that state.
 */
export const SEED_SERVICE_ASSETS = [1, 2, 3].map((n) => ({
	id: `e2e0c455-0000-4000-8000-00000000000${n}`,
	tag: `E2E-SVC-0${n}`,
	/** The unit's repair, on no project: a contractor is engaged on existing work. */
	workOrderId: `e2e0c0a0-0000-4000-8000-00000000000${n}`,
	title: `Retube E2E-SVC-0${n}`
}));

export async function seedContractors() {
	await withPlatformDb(async (db) => {
		const contractorIds = [SEED_CONTRACTOR_ID, SEED_ARCHIVED_CONTRACTOR_ID];

		const jobWorkOrders = await db
			.select({ id: contractorJob.workOrderId })
			.from(contractorJob)
			.where(inArray(contractorJob.contractorId, contractorIds));
		await db.delete(contractorJob).where(inArray(contractorJob.contractorId, contractorIds));
		if (jobWorkOrders.length > 0) {
			await db.delete(workOrder).where(
				inArray(
					workOrder.id,
					jobWorkOrders.map((r) => r.id)
				)
			);
		}
		await db.delete(workOrder).where(
			inArray(
				workOrder.id,
				SEED_SERVICE_ASSETS.map((a) => a.workOrderId)
			)
		);
		await db.delete(contractor).where(inArray(contractor.id, contractorIds));
		const assetIds = SEED_SERVICE_ASSETS.map((a) => a.id);
		await db.delete(stockMovement).where(inArray(stockMovement.assetId, assetIds));
		await db.delete(inventoryAsset).where(inArray(inventoryAsset.id, assetIds));
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

		await db.insert(inventoryAsset).values(
			SEED_SERVICE_ASSETS.map((a) => ({
				id: a.id,
				itemId: SEED_SERVICE_ITEM_ID,
				assetTag: a.tag,
				condition: 'good' as const,
				status: 'in_service' as const,
				createdAt: now,
				updatedAt: now
			}))
		);

		await db.insert(workOrder).values(
			SEED_SERVICE_ASSETS.map((a) => ({
				id: a.workOrderId,
				title: a.title,
				assetId: a.id,
				createdAt: now,
				updatedAt: now
			}))
		);

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
