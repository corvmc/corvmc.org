/**
 * Seed inventory for the e2e suite: one serialized item with a tagged unit, one
 * bulk consumable, and the receiving that puts both on the ledger.
 *
 * The point of this fixture is the *invariant*, not the rows. On-hand is the sum
 * of `stock_movement` and is never stored, so an e2e that receives, consumes and
 * returns has to land back on a number nobody wrote down. A fixture that inserted
 * quantities directly would test nothing.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: deletes and recreates its own rows on every run. The category is
 * shared with the dev seed, so it is upserted rather than deleted.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import {
	acquisition,
	acquisitionLine,
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryLoan,
	inventoryLocation,
	stockMovement
} from '../../src/lib/server/db/schema/inventory';
import { withPlatformDb } from './platform-db';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export const SEED_CATEGORY_ID = 'e2e-inv-category';
export const SEED_LOCATION_ID = 'e2e-inv-location';

/** A serialized item — one record per physical unit. */
export const SEED_ITEM_ID = 'e2e-inv-item-amp';
export const SEED_ITEM_NAME = 'E2E Test Amplifier';
export const SEED_ASSET_ID = 'e2e-inv-asset-amp-1';
export const SEED_ASSET_TAG = 'E2E-000001';

/** A unit that arrives without a sticker, so tag binding has something to bind. */
export const SEED_UNTAGGED_ASSET_ID = 'e2e-inv-asset-amp-2';

/** A bulk consumable — counted, and it does not come back. */
export const SEED_CONSUMABLE_ID = 'e2e-inv-item-strings';
export const SEED_CONSUMABLE_NAME = 'E2E Test Strings';
export const SEED_CONSUMABLE_RECEIVED = 20;
export const SEED_CONSUMABLE_REORDER_POINT = 4;

const SEED_ACQUISITION_ID = 'e2e-inv-acquisition';
const ASSET_IDS = [SEED_ASSET_ID, SEED_UNTAGGED_ASSET_ID];
const ITEM_IDS = [SEED_ITEM_ID, SEED_CONSUMABLE_ID];

async function ensureCategory(db: DrizzleD1Database) {
	const [existing] = await db
		.select({ id: equipmentCategory.id })
		.from(equipmentCategory)
		.where(eq(equipmentCategory.id, SEED_CATEGORY_ID))
		.limit(1);
	if (existing) return;

	await db.insert(equipmentCategory).values({
		id: SEED_CATEGORY_ID,
		name: 'E2E Test Gear',
		displayOrder: 99,
		pricingTier: 'major'
	});
}

export async function seedInventory(): Promise<void> {
	await withPlatformDb(async (db) => {
		// Clean slate, children first — FKs may be enforced on local D1.
		await db.delete(stockMovement).where(inArray(stockMovement.itemId, ITEM_IDS));
		await db.delete(inventoryLoan).where(inArray(inventoryLoan.itemId, ITEM_IDS));
		await db.delete(acquisitionLine).where(inArray(acquisitionLine.itemId, ITEM_IDS));
		await db.delete(acquisition).where(eq(acquisition.id, SEED_ACQUISITION_ID));
		await db.delete(inventoryAsset).where(inArray(inventoryAsset.id, ASSET_IDS));
		await db.delete(inventoryItem).where(inArray(inventoryItem.id, ITEM_IDS));
		await db.delete(inventoryLocation).where(eq(inventoryLocation.id, SEED_LOCATION_ID));

		await ensureCategory(db);

		const now = new Date();

		await db.insert(inventoryLocation).values({
			id: SEED_LOCATION_ID,
			name: 'E2E Storage',
			displayOrder: 99
		});

		await db.insert(inventoryItem).values([
			{
				id: SEED_ITEM_ID,
				name: SEED_ITEM_NAME,
				description: 'Seeded for the inventory e2e.',
				categoryId: SEED_CATEGORY_ID,
				kind: 'serialized',
				isLoanable: true
			},
			{
				id: SEED_CONSUMABLE_ID,
				name: SEED_CONSUMABLE_NAME,
				categoryId: SEED_CATEGORY_ID,
				kind: 'bulk',
				unitOfMeasure: 'pack',
				// Not loanable: bulk + not loanable is what *makes* a consumable.
				isLoanable: false,
				reorderPoint: SEED_CONSUMABLE_REORDER_POINT,
				reorderQuantity: 12
			}
		]);

		await db.insert(acquisition).values({
			id: SEED_ACQUISITION_ID,
			kind: 'purchase',
			occurredAt: now,
			sourceName: 'E2E Supplier',
			reference: 'E2E-0001',
			totalCents: 100_000
		});

		await db.insert(acquisitionLine).values([
			{
				id: 'e2e-inv-line-amp',
				acquisitionId: SEED_ACQUISITION_ID,
				itemId: SEED_ITEM_ID,
				quantity: 2,
				unitValueCents: 40_000
			},
			{
				id: 'e2e-inv-line-strings',
				acquisitionId: SEED_ACQUISITION_ID,
				itemId: SEED_CONSUMABLE_ID,
				quantity: SEED_CONSUMABLE_RECEIVED,
				unitValueCents: 700
			}
		]);

		await db.insert(inventoryAsset).values([
			{
				id: SEED_ASSET_ID,
				itemId: SEED_ITEM_ID,
				assetTag: SEED_ASSET_TAG,
				serialNumber: 'E2E-SER-0001',
				condition: 'good',
				status: 'in_service',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID
			},
			{
				id: SEED_UNTAGGED_ASSET_ID,
				itemId: SEED_ITEM_ID,
				assetTag: null,
				condition: 'good',
				status: 'in_service',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID
			}
		]);

		// The ledger the rows above imply. One `receive` per serialized unit, one
		// for the whole consumable line — the same shape the services write.
		await db.insert(stockMovement).values([
			{
				id: 'e2e-inv-mv-amp-1',
				itemId: SEED_ITEM_ID,
				assetId: SEED_ASSET_ID,
				quantity: 1,
				reason: 'receive',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID,
				occurredAt: now
			},
			{
				id: 'e2e-inv-mv-amp-2',
				itemId: SEED_ITEM_ID,
				assetId: SEED_UNTAGGED_ASSET_ID,
				quantity: 1,
				reason: 'receive',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID,
				occurredAt: now
			},
			{
				id: 'e2e-inv-mv-strings',
				itemId: SEED_CONSUMABLE_ID,
				quantity: SEED_CONSUMABLE_RECEIVED,
				reason: 'receive',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID,
				occurredAt: now
			}
		]);
	});
}
