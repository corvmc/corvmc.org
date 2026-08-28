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
	inventoryItemArticle,
	inventoryLoan,
	inventoryLocation,
	stockMovement
} from '../../src/lib/server/db/schema/inventory';
import { helpArticle, helpCategory } from '../../src/lib/server/db/schema/help';
import { withPlatformDb } from './platform-db';
import { SEED_STAFF_ID } from './seed-staff-user';
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

/**
 * A unit that is already in the shop, so "you cannot report this twice" has a
 * subject of its own.
 *
 * It used to borrow the unit the damage-report test had just taken out of
 * service, which made the two order-dependent: a retry of the reporting test
 * starts from data the fixture never described, and this one then fails for a
 * reason that has nothing to do with what it is checking.
 */
export const SEED_MAINTENANCE_ASSET_ID = 'e2e-inv-asset-in-shop';
export const SEED_MAINTENANCE_ASSET_TAG = 'E2E-000013';

/** A bulk consumable — counted, and it does not come back. Well stocked. */
export const SEED_CONSUMABLE_ID = 'e2e-inv-item-strings';
export const SEED_CONSUMABLE_NAME = 'E2E Test Strings';
export const SEED_CONSUMABLE_RECEIVED = 20;
export const SEED_CONSUMABLE_REORDER_POINT = 4;

/**
 * A second consumable, deliberately below its reorder point.
 *
 * Without one, the restock list and the dashboard's low-stock section only ever
 * render their empty states in e2e — the populated path, which is the entire
 * feature, would go untested.
 */
export const SEED_LOW_ID = 'e2e-inv-item-batteries';
export const SEED_LOW_NAME = 'E2E Test Batteries';
export const SEED_LOW_RECEIVED = 6;
export const SEED_LOW_CONSUMED = 4;
export const SEED_LOW_REORDER_POINT = 5;
export const SEED_LOW_REORDER_QUANTITY = 20;
/** 6 received − 4 used = 2, against a point of 5. */
export const SEED_LOW_ON_HAND = SEED_LOW_RECEIVED - SEED_LOW_CONSUMED;

/**
 * A donated unit disposed of inside the three-year window, so the Form 8282
 * warning has something to fire on. Received 400 days ago, retired 40 days ago:
 * comfortably inside three years, and with most of the 125 days still to run.
 */
export const SEED_DONATION_ID = 'e2e-inv-acq-donation';
export const SEED_DISPOSED_ASSET_ID = 'e2e-inv-asset-donated';
export const SEED_DISPOSED_ASSET_TAG = 'E2E-000009';

/**
 * A second donated disposal, this one with **no signed Form 8283**. It must not
 * appear as an obligation: the signature is what makes property reportable, so
 * flagging this would be the false positive the narrowing exists to remove.
 */
export const SEED_UNACKED_DONATION_ID = 'e2e-inv-acq-donation-unacked';
export const SEED_UNACKED_ASSET_ID = 'e2e-inv-asset-unacked';
export const SEED_UNACKED_ASSET_TAG = 'E2E-000011';

/**
 * A third donated disposal with no signed 8283 — **owned by the test that signs
 * one**, which is why it is not the row above.
 *
 * The signing test mutates the acquisition, and a spec that mutates a seeded row
 * owns it: sharing `SEED_UNACKED_DONATION_ID` would leave the "raises nothing"
 * assertion passing or failing depending on which test ran first, and failing
 * differently on a retry that starts from data the fixture never described.
 */
export const SEED_SIGN_DONATION_ID = 'e2e-inv-acq-donation-to-sign';
export const SEED_SIGN_ASSET_ID = 'e2e-inv-asset-to-sign';
export const SEED_SIGN_ASSET_TAG = 'E2E-000012';
export const SEED_SIGN_DONOR = 'E2E Signable Donor';

/**
 * A shop trip somebody fronted and has not been paid back for. Owned by the
 * reimbursement test, which settles it.
 */
export const SEED_OWED_ACQUISITION_ID = 'e2e-inv-acq-owed';
export const SEED_OWED_SUPPLIER = 'E2E Corner Music';
export const SEED_OWED_CENTS = 4_800;

/** A published how-to linked to the serialized item, for the resources panel. */
export const SEED_ARTICLE_ID = 'e2e-inv-article';
export const SEED_ARTICLE_TITLE = 'E2E How To Use The Amp';
export const SEED_ARTICLE_SLUG = 'e2e-how-to-use-the-amp';

const SEED_ACQUISITION_ID = 'e2e-inv-acquisition';
const ASSET_IDS = [
	SEED_ASSET_ID,
	SEED_UNTAGGED_ASSET_ID,
	SEED_DISPOSED_ASSET_ID,
	SEED_UNACKED_ASSET_ID,
	SEED_SIGN_ASSET_ID,
	SEED_MAINTENANCE_ASSET_ID
];
const ITEM_IDS = [SEED_ITEM_ID, SEED_CONSUMABLE_ID, SEED_LOW_ID];

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
		await db
			.delete(acquisition)
			.where(
				inArray(acquisition.id, [
					SEED_ACQUISITION_ID,
					SEED_DONATION_ID,
					SEED_UNACKED_DONATION_ID,
					SEED_SIGN_DONATION_ID,
					SEED_OWED_ACQUISITION_ID
				])
			);
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
			},
			{
				id: SEED_LOW_ID,
				name: SEED_LOW_NAME,
				categoryId: SEED_CATEGORY_ID,
				kind: 'bulk',
				unitOfMeasure: 'box',
				isLoanable: false,
				reorderPoint: SEED_LOW_REORDER_POINT,
				reorderQuantity: SEED_LOW_REORDER_QUANTITY
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

		// A donation, received well over a year ago. Its unit is retired below,
		// which is what puts a live Form 8282 obligation on the compliance list.
		await db.insert(acquisition).values({
			id: SEED_DONATION_ID,
			kind: 'donation',
			occurredAt: new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000),
			sourceName: 'E2E Donor',
			fairValueCents: 80_000,
			fairValueBasis: 'Comparable sales',
			intendedUse: 'Practice room backline',
			acknowledgedAt: new Date(now.getTime() - 398 * 24 * 60 * 60 * 1000)
		});

		// Same shape, no acknowledgment: nothing was ever signed for it.
		await db.insert(acquisition).values({
			id: SEED_UNACKED_DONATION_ID,
			kind: 'donation',
			occurredAt: new Date(now.getTime() - 300 * 24 * 60 * 60 * 1000),
			sourceName: 'E2E Casual Donor',
			fairValueCents: 4_000
		});

		// Unsigned, and its unit already disposed of — so signing the 8283 is the
		// single act that turns it into an obligation. That transition is the one
		// production could never make: nothing could write `acknowledgedAt`.
		await db.insert(acquisition).values({
			id: SEED_SIGN_DONATION_ID,
			kind: 'donation',
			occurredAt: new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000),
			sourceName: SEED_SIGN_DONOR,
			fairValueCents: 600_000,
			fairValueBasis: 'Independent appraisal'
		});

		// Fronted out of pocket by the staff operator, unreimbursed.
		await db.insert(acquisition).values({
			id: SEED_OWED_ACQUISITION_ID,
			kind: 'purchase',
			occurredAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
			sourceName: SEED_OWED_SUPPLIER,
			totalCents: SEED_OWED_CENTS,
			paidByUserId: SEED_STAFF_ID
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
			},
			{
				id: 'e2e-inv-line-batteries',
				acquisitionId: SEED_ACQUISITION_ID,
				itemId: SEED_LOW_ID,
				quantity: SEED_LOW_RECEIVED,
				unitValueCents: 1400
			}
		]);

		// A help article and its link. Tutorials are help rows rather than prose of
		// this module's own, so the fixture seeds one the same way the app would.
		await db.delete(inventoryItemArticle).where(inArray(inventoryItemArticle.itemId, ITEM_IDS));
		await db.delete(helpArticle).where(eq(helpArticle.id, SEED_ARTICLE_ID));
		// No other fixture seeds help, so this one creates its own category rather
		// than silently skipping when none exists — which is exactly how the
		// resources panel came to have no coverage on its first run.
		const SEED_HELP_CATEGORY_ID = 'e2e-inv-help-cat';
		await db
			.insert(helpCategory)
			.values({
				id: SEED_HELP_CATEGORY_ID,
				name: 'E2E Gear Guides',
				slug: 'e2e-gear-guides',
				sortOrder: 99,
				minRole: 'member'
			})
			.onConflictDoNothing();
		const helpCat = { id: SEED_HELP_CATEGORY_ID };
		{
			await db.insert(helpArticle).values({
				id: SEED_ARTICLE_ID,
				categoryId: helpCat.id,
				title: SEED_ARTICLE_TITLE,
				slug: SEED_ARTICLE_SLUG,
				summary: 'Seeded for the inventory e2e.',
				content: '## Plug it in\n\nThen turn it up.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			});
			await db.insert(inventoryItemArticle).values({
				id: 'e2e-inv-item-article',
				itemId: SEED_ITEM_ID,
				articleId: SEED_ARTICLE_ID
			});
		}

		await db.insert(inventoryAsset).values([
			{
				id: SEED_UNACKED_ASSET_ID,
				itemId: SEED_ITEM_ID,
				assetTag: SEED_UNACKED_ASSET_TAG,
				condition: 'poor',
				status: 'retired',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_UNACKED_DONATION_ID,
				retiredAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
				retiredReason: 'Beyond repair'
			},
			{
				// Disposed of, donated, and with no 8283 on record — so it owes
				// nothing until the test signs one. Owned by that test.
				id: SEED_SIGN_ASSET_ID,
				itemId: SEED_ITEM_ID,
				assetTag: SEED_SIGN_ASSET_TAG,
				condition: 'poor',
				status: 'retired',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_SIGN_DONATION_ID,
				retiredAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
				retiredReason: 'Sold at the swap meet'
			},
			{
				id: SEED_DISPOSED_ASSET_ID,
				itemId: SEED_ITEM_ID,
				assetTag: SEED_DISPOSED_ASSET_TAG,
				condition: 'poor',
				status: 'retired',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_DONATION_ID,
				// 40 days ago: inside three years of receipt, and with most of the
				// 125-day filing window still to run.
				retiredAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
				retiredReason: 'Cracked cabinet'
			},
			{
				id: SEED_MAINTENANCE_ASSET_ID,
				itemId: SEED_ITEM_ID,
				assetTag: SEED_MAINTENANCE_ASSET_TAG,
				condition: 'poor',
				status: 'maintenance',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID
			},
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
			},
			{
				id: 'e2e-inv-mv-batteries-in',
				itemId: SEED_LOW_ID,
				quantity: SEED_LOW_RECEIVED,
				reason: 'receive',
				locationId: SEED_LOCATION_ID,
				acquisitionId: SEED_ACQUISITION_ID,
				occurredAt: now
			},
			// Used down below the reorder point through the ledger, not by writing
			// a total — the same way the app would do it.
			{
				id: 'e2e-inv-mv-batteries-out',
				itemId: SEED_LOW_ID,
				quantity: -SEED_LOW_CONSUMED,
				reason: 'consume',
				locationId: SEED_LOCATION_ID,
				occurredAt: now,
				notes: 'Wireless packs'
			}
		]);
	});
}
