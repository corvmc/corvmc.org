import { sqliteTable, text, integer, index, check, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import {
	acquisitionKinds,
	assetStatuses,
	equipmentConditions,
	itemKinds,
	loanStatuses,
	pricingTiers,
	stockReasons,
	unitsOfMeasure
} from '../../../config';

// ---------------------------------------------------------------------------
// Inventory domain types
//
// One catalog, split three ways along the seam the old `equipment` table kept
// tripping over: a *kind of thing* (`inventory_item`), a *particular thing*
// (`inventory_asset`), and *something that happened* (`stock_movement`).
//
// The rule the whole module rests on: **stock is a ledger, not a number.**
// On-hand is the sum of movements and is never stored as an authoritative
// figure — a stocktake correction is itself a movement, with reason `adjust`.
// See `docs/specs/inventory-spec.md`.
// ---------------------------------------------------------------------------

export type ItemKind = (typeof itemKinds)[number];
export type StockReason = (typeof stockReasons)[number];
export type AssetStatus = (typeof assetStatuses)[number];
export type AcquisitionKind = (typeof acquisitionKinds)[number];
export type EquipmentCondition = (typeof equipmentConditions)[number];
export type PricingTier = (typeof pricingTiers)[number];
export type LoanStatus = (typeof loanStatuses)[number];

export function isItemKind(value: string): value is ItemKind {
	return itemKinds.includes(value as ItemKind);
}

export function isStockReason(value: string): value is StockReason {
	return stockReasons.includes(value as StockReason);
}

export function isAssetStatus(value: string): value is AssetStatus {
	return assetStatuses.includes(value as AssetStatus);
}

export function isEquipmentCondition(value: string): value is EquipmentCondition {
	return equipmentConditions.includes(value as EquipmentCondition);
}

export function isPricingTier(value: string): value is PricingTier {
	return pricingTiers.includes(value as PricingTier);
}

export function isLoanStatus(value: string): value is LoanStatus {
	return loanStatuses.includes(value as LoanStatus);
}

/**
 * Which reasons add to stock and which take away.
 *
 * The sign belongs to the reason, never to the caller — a service that could
 * pass `-5` with reason `receive` is a service that can corrupt the ledger by
 * typo. `adjust` is the sole two-way reason, which is what makes it the honest
 * way to record a stocktake rather than editing a total.
 */
export const STOCK_REASON_SIGN: Record<StockReason, 1 | -1 | 0> = {
	receive: 1,
	loan_return: 1,
	repair_in: 1,
	loan_out: -1,
	consume: -1,
	repair_out: -1,
	loss: -1,
	retire: -1,
	transfer: 0,
	adjust: 0
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
	name: z.string().min(1).max(100),
	displayOrder: z.coerce.number().int().min(0).default(0),
	pricingTier: z.enum(pricingTiers)
});

export const updateCategorySchema = createCategorySchema.partial();

export const createLocationSchema = z.object({
	name: z.string().min(1).max(100),
	parentId: z.uuid().optional(),
	displayOrder: z.coerce.number().int().min(0).default(0),
	notes: z.string().max(2000).optional()
});

export const updateLocationSchema = createLocationSchema.partial();

export const createItemSchema = z.object({
	name: z.string().min(1).max(255),
	description: z.string().max(2000).optional(),
	categoryId: z.uuid(),
	kind: z.enum(itemKinds),
	unitOfMeasure: z.enum(unitsOfMeasure).default('each'),
	gtin: z.string().max(14).optional(),
	isLoanable: z.coerce.boolean().default(true),
	reorderPoint: z.coerce.number().int().min(0).optional(),
	reorderQuantity: z.coerce.number().int().min(1).optional(),
	resourceId: z.string().max(100).optional(),
	notes: z.string().max(2000).optional()
});

export const updateItemSchema = createItemSchema.partial();

export const createAssetSchema = z.object({
	itemId: z.uuid(),
	assetTag: z.string().max(64).optional(),
	serialNumber: z.string().max(100).optional(),
	condition: z.enum(equipmentConditions),
	locationId: z.uuid().optional(),
	notes: z.string().max(2000).optional()
});

export const updateAssetSchema = createAssetSchema.partial().omit({ itemId: true });

/** Binding a printed tag to a unit. Rebinding is normal; see the spec. */
export const bindAssetTagSchema = z.object({
	assetId: z.uuid(),
	assetTag: z.string().min(1).max(64)
});

export const recordMovementSchema = z.object({
	itemId: z.uuid(),
	assetId: z.uuid().optional(),
	quantity: z.coerce.number().int(),
	reason: z.enum(stockReasons),
	locationId: z.uuid().optional(),
	toLocationId: z.uuid().optional(),
	notes: z.string().max(1000).optional()
});

export const acquisitionLineSchema = z.object({
	itemId: z.uuid(),
	quantity: z.coerce.number().int().min(1),
	unitValueCents: z.coerce.number().int().min(0).optional()
});

export const createAcquisitionSchema = z.object({
	kind: z.enum(acquisitionKinds),
	occurredAt: z.coerce.date(),
	sourceName: z.string().max(255).optional(),
	donorUserId: z.string().max(64).optional(),
	reference: z.string().max(100).optional(),
	totalCents: z.coerce.number().int().min(0).optional(),
	fairValueCents: z.coerce.number().int().min(0).optional(),
	fairValueBasis: z.string().max(1000).optional(),
	intendedUse: z.string().max(1000).optional(),
	locationId: z.uuid().optional(),
	notes: z.string().max(2000).optional(),
	lines: z.array(acquisitionLineSchema).min(1).max(100)
});

export const requestLoanSchema = z.object({
	itemId: z.uuid().optional(),
	quantity: z.coerce.number().int().min(1).default(1),
	requestedPickupDate: z.coerce.date(),
	estimatedReturnDate: z.coerce.date(),
	memberNotes: z.string().max(1000).optional()
});

export const scheduleLoanSchema = z.object({
	itemId: z.uuid(),
	scheduledPickupDate: z.coerce.date()
});

export const checkoutLoanSchema = z.object({
	dueDate: z.coerce.date(),
	assetId: z.uuid().optional()
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const equipmentCategory = sqliteTable('equipment_category', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull().unique(),
	displayOrder: integer('display_order').notNull().default(0),
	pricingTier: text('pricing_tier', { enum: pricingTiers }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

/**
 * Where a thing is. Hierarchical because "main room → stage left rack" is how
 * people describe it out loud, and a flat list forces that into the name.
 */
export const inventoryLocation = sqliteTable(
	'inventory_location',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		parentId: text('parent_id'),
		displayOrder: integer('display_order').notNull().default(0),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_location_parent').on(t.parentId)]
);

/**
 * The catalog: a *type*, never a physical object.
 *
 * `kind` says how a thing is *tracked*: `serialized` items have one
 * `inventory_asset` row per unit carrying its serial, condition and donor;
 * `bulk` items are a count in the ledger and nothing more.
 *
 * Whether it comes back is a separate axis, `isLoanable` — cables are bulk and
 * returnable, strings are bulk and consumed. A consumable is derived, not
 * stored: `kind = 'bulk' AND NOT is_loanable`.
 *
 * Note what is **absent**: there is no quantity column. That is the point — the
 * old `equipment.totalQuantity` was a number somebody typed, and it is the
 * reason consumables could not be tracked at all.
 */
export const inventoryItem = sqliteTable(
	'inventory_item',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		description: text('description'),
		categoryId: text('category_id')
			.notNull()
			.references(() => equipmentCategory.id, { onDelete: 'restrict' }),
		kind: text('kind', { enum: itemKinds }).notNull(),
		unitOfMeasure: text('unit_of_measure', { enum: unitsOfMeasure }).notNull().default('each'),
		/** The manufacturer's UPC/EAN where one exists — scan it, don't invent a SKU. */
		gtin: text('gtin'),
		isLoanable: integer('is_loanable', { mode: 'boolean' }).notNull().default(true),
		reorderPoint: integer('reorder_point'),
		reorderQuantity: integer('reorder_quantity'),
		resourceId: text('resource_id'),
		imageUrl: text('image_url'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(t) => [
		index('idx_item_category').on(t.categoryId),
		index('idx_item_kind').on(t.kind),
		index('idx_item_gtin')
			.on(t.gtin)
			.where(sql`gtin IS NOT NULL`),
		index('idx_item_resource_id')
			.on(t.resourceId)
			.where(sql`resource_id IS NOT NULL`),
		check('item_reorder_bulk_only', sql`reorder_point IS NULL OR kind = 'bulk'`)
	]
);

/**
 * One physical unit of a `serialized` item. Four K12.2s are one item and four
 * assets.
 *
 * `assetTag` is nullable on purpose: gear gets entered before the roll of
 * printed stickers arrives, and a `NOT NULL` here would force placeholders into
 * a unique column — which is how `TEMP-7` ends up on two amps. A tag is
 * **bound**, not generated, so a lost sticker is a rebind: an asset's identity
 * is this row, never the label on it.
 */
export const inventoryAsset = sqliteTable(
	'inventory_asset',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		itemId: text('item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'restrict' }),
		assetTag: text('asset_tag'),
		serialNumber: text('serial_number'),
		condition: text('condition', { enum: equipmentConditions }).notNull(),
		status: text('status', { enum: assetStatuses }).notNull().default('in_service'),
		locationId: text('location_id').references(() => inventoryLocation.id, {
			onDelete: 'set null'
		}),
		acquisitionId: text('acquisition_id'),
		retiredAt: integer('retired_at', { mode: 'timestamp' }),
		retiredReason: text('retired_reason'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		unique('uniq_asset_tag').on(t.assetTag),
		index('idx_asset_item').on(t.itemId),
		index('idx_asset_status').on(t.status),
		index('idx_asset_location').on(t.locationId),
		index('idx_asset_acquisition').on(t.acquisitionId)
	]
);

/**
 * The ledger. Append-only, and the only thing that may change what the
 * collective holds.
 *
 * Shaped after the GS1 EPCIS event — what (`itemId`/`assetId`), when
 * (`occurredAt`), where (`locationId`), why (`reason`), who (`actorId`) — with
 * `loanId`/`acquisitionId` naming whatever caused it. Nothing here is ever
 * updated or deleted; a mistake is corrected by a compensating `adjust`.
 */
export const stockMovement = sqliteTable(
	'stock_movement',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		itemId: text('item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'restrict' }),
		assetId: text('asset_id').references(() => inventoryAsset.id, { onDelete: 'set null' }),
		/** Signed. The sign comes from `STOCK_REASON_SIGN`, never from a caller. */
		quantity: integer('quantity').notNull(),
		reason: text('reason', { enum: stockReasons }).notNull(),
		locationId: text('location_id').references(() => inventoryLocation.id, {
			onDelete: 'set null'
		}),
		toLocationId: text('to_location_id').references(() => inventoryLocation.id, {
			onDelete: 'set null'
		}),
		actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
		occurredAt: integer('occurred_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		loanId: text('loan_id'),
		acquisitionId: text('acquisition_id'),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_movement_item').on(t.itemId),
		index('idx_movement_asset').on(t.assetId),
		index('idx_movement_occurred').on(t.occurredAt),
		index('idx_movement_reason').on(t.reason),
		index('idx_movement_loan').on(t.loanId),
		index('idx_movement_acquisition').on(t.acquisitionId),
		check('movement_qty_nonzero', sql`quantity != 0`)
	]
);

/**
 * How stock arrived — a purchase, a donation or a grant.
 *
 * One table for all three because they are the same event with different
 * paperwork, and because splitting them would mean two receiving paths that
 * could drift. Every `receive` movement hangs off one of these, including the
 * $4 pack of strings somebody picked up on the way in: a receipt with no cost
 * attached is a row no later migration can improve, since the receipt is gone.
 *
 * The `fairValue*` / `intendedUse` / `monetized` / `acknowledgedAt` fields are
 * what FASB ASU 2020-07 requires a nonprofit to disclose about contributed
 * nonfinancial assets. They exist from the start because they are not
 * reconstructable a year later when the report is due.
 */
export const acquisition = sqliteTable(
	'acquisition',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		kind: text('kind', { enum: acquisitionKinds }).notNull(),
		occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
		/** Free text until Phase 2's `supplier` table normalises it. */
		sourceName: text('source_name'),
		donorUserId: text('donor_user_id').references(() => user.id, { onDelete: 'set null' }),
		reference: text('reference'),
		totalCents: integer('total_cents'),
		fairValueCents: integer('fair_value_cents'),
		fairValueBasis: text('fair_value_basis'),
		intendedUse: text('intended_use'),
		monetized: integer('monetized', { mode: 'boolean' }).notNull().default(false),
		acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
		appraisalRef: text('appraisal_ref'),
		recordedByUserId: text('recorded_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		notes: text('notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_acquisition_kind').on(t.kind),
		index('idx_acquisition_occurred').on(t.occurredAt),
		index('idx_acquisition_donor').on(t.donorUserId)
	]
);

export const acquisitionLine = sqliteTable(
	'acquisition_line',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		acquisitionId: text('acquisition_id')
			.notNull()
			.references(() => acquisition.id, { onDelete: 'cascade' }),
		itemId: text('item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'restrict' }),
		quantity: integer('quantity').notNull(),
		unitValueCents: integer('unit_value_cents'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_acq_line_acquisition').on(t.acquisitionId),
		index('idx_acq_line_item').on(t.itemId),
		check('acq_line_qty_positive', sql`quantity > 0`)
	]
);

/**
 * The loan, rebuilt from `equipment_loan`.
 *
 * Same five states, same money columns, same charge rules — what changes is
 * that it names an `itemId` from the moment it is requested and an `assetId`
 * from the moment a *particular* unit is handed over. A bulk loan (three
 * cables) never names one.
 */
export const inventoryLoan = sqliteTable(
	'inventory_loan',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		itemId: text('item_id').references(() => inventoryItem.id, { onDelete: 'set null' }),
		assetId: text('asset_id').references(() => inventoryAsset.id, { onDelete: 'set null' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		quantity: integer('quantity').notNull().default(1),
		requestedPickupDate: integer('requested_pickup_date', { mode: 'timestamp' }).notNull(),
		estimatedReturnDate: integer('estimated_return_date', { mode: 'timestamp' }),
		scheduledPickupDate: integer('scheduled_pickup_date', { mode: 'timestamp' }),
		dueDate: integer('due_date', { mode: 'timestamp' }),
		checkedOutAt: integer('checked_out_at', { mode: 'timestamp' }),
		returnedAt: integer('returned_at', { mode: 'timestamp' }),
		status: text('status', { enum: loanStatuses }).notNull().default('requested'),
		dailyRateCents: integer('daily_rate_cents'),
		estimatedCostCents: integer('estimated_cost_cents'),
		totalChargeCents: integer('total_charge_cents'),
		creditsCents: integer('credits_cents'),
		cashCents: integer('cash_cents'),
		memberNotes: text('member_notes'),
		staffNotes: text('staff_notes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_loan_item').on(t.itemId),
		index('idx_loan_asset').on(t.assetId),
		index('idx_loan_user').on(t.userId),
		index('idx_loan_status').on(t.status),
		check('loan_qty_positive', sql`quantity > 0`)
	]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type EquipmentCategory = typeof equipmentCategory.$inferSelect;
export type InventoryLocation = typeof inventoryLocation.$inferSelect;
export type InventoryItem = typeof inventoryItem.$inferSelect;
export type InventoryAsset = typeof inventoryAsset.$inferSelect;
export type StockMovement = typeof stockMovement.$inferSelect;
export type Acquisition = typeof acquisition.$inferSelect;
export type AcquisitionLine = typeof acquisitionLine.$inferSelect;
export type InventoryLoan = typeof inventoryLoan.$inferSelect;
