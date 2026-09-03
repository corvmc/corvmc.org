import { sqliteTable, text, integer, index, check, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import { flagStatuses } from './flag';
import {
	acquisitionKinds,
	assetStatuses,
	equipmentConditions,
	itemKinds,
	loanStatuses,
	orderStatuses,
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
//
// Only the four something actually parses with. Eleven more used to sit here —
// create/update pairs for locations, items and assets, plus tag binding,
// movements, acquisitions and loan requests — and nothing outside this file ever
// imported one.
//
// The remote layer declares its own inline, because a `form()` schema is shaped
// by what the *form* sends (a cleared number field is dropped, `.transform()`
// breaks `fields` inference) rather than by what the table holds. Two parallel
// definitions of one shape, only one of them ever executed, is a trap:
// `createAcquisitionSchema` had quietly fallen behind and was missing
// `monetized`, `acknowledgedAt` and `appraisalRef` altogether.
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
	name: z.string().min(1).max(100),
	displayOrder: z.coerce.number().int().min(0).default(0),
	pricingTier: z.enum(pricingTiers)
});

export const updateCategorySchema = createCategorySchema.partial();

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
		/**
		 * When somebody recorded what happened about Form 8282 — either that it
		 * was filed, or that no filing was needed. One nullable stamp rather than
		 * a status enum: the only question the system can answer is "has a human
		 * dealt with this", and `form8282Note` carries which way they went.
		 *
		 * Disposing of donated property within three years of receipt obliges the
		 * organisation to file within 125 days and copy the donor. See
		 * `form-8282.ts` for the rule; the system flags, a person decides.
		 */
		form8282ResolvedAt: integer('form_8282_resolved_at', { mode: 'timestamp' }),
		form8282Note: text('form_8282_note'),
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
		/**
		 * Who fronted the money, when it was not the collective's own card.
		 *
		 * Deliberately distinct from `recordedByUserId` (who typed the row in) and
		 * from `donorUserId` (who gave the goods). A volunteer who buys strings on
		 * the way in is owed for them; a volunteer who *donates* strings is not,
		 * and conflating the two would turn a gift into a debt.
		 */
		paidByUserId: text('paid_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		/**
		 * The order this arrival fulfilled, when it fulfilled one.
		 *
		 * Nullable and always will be: most arrivals are not ordered — a donation
		 * walks in, and a stocktake's opening balance was never bought at all.
		 *
		 * Bare `text`, with no `references()`, and that is the one deliberate
		 * exception in this pair. Adding a foreign key to an *existing* table is
		 * not an `ALTER` in SQLite — it is a table rebuild, and a rebuild of
		 * `acquisition` on D1 takes its `ON DELETE CASCADE` children
		 * (`acquisition_line`) with it. A nullable column is a plain
		 * `ADD COLUMN`; the two new tables below carry real references because
		 * nothing has to be rebuilt to create them.
		 */
		purchaseOrderId: text('purchase_order_id'),
		/**
		 * When they were paid back. The transfer itself happens outside the app —
		 * this records that a person settled it, the same way `form8282ResolvedAt`
		 * records that a person dealt with a filing.
		 */
		reimbursedAt: integer('reimbursed_at', { mode: 'timestamp' }),
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
		index('idx_acquisition_donor').on(t.donorUserId),
		index('idx_acquisition_paid_by').on(t.paidByUserId)
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
 * A purchase order: what we have decided to buy, before it exists here.
 *
 * The gap this closes is **duplicate buying**. `/staff/inventory/restock` is
 * recomputed from reorder points on every load and remembers nothing, so
 * ordering ten packs of strings on Monday leaves the list saying "out — buy 10"
 * all week. Nothing in the schema could tell *"we are out"* from *"we are out
 * but ten arrive Thursday"*, and that failure lands on the module's most-used
 * surface.
 *
 * Its own table rather than a status on `acquisition`, for the reason written
 * out at `orderStatuses`: an acquisition means *something arrived*, and this
 * means *something was promised*. Keeping them apart is what lets every money
 * report stay exactly as it is.
 *
 * `supplierName` is free text, matching `acquisition.sourceName`. A `supplier`
 * table was argued out and declined in the spec; the multi-line receipt is what
 * actually fixes the `GROUP BY sourceName` fragmentation.
 */
export const purchaseOrder = sqliteTable(
	'purchase_order',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		status: text('status', { enum: orderStatuses }).notNull().default('draft'),
		supplierName: text('supplier_name'),
		reference: text('reference'),
		/** When it was sent to the supplier. Null while it is still a draft. */
		placedAt: integer('placed_at', { mode: 'timestamp' }),
		/** When the supplier said it would arrive; drives the "late" list. */
		expectedAt: integer('expected_at', { mode: 'timestamp' }),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
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
		index('idx_purchase_order_status').on(t.status),
		index('idx_purchase_order_expected').on(t.expectedAt)
	]
);

/**
 * One item on an order, and how much of it has turned up.
 *
 * `quantityReceived` is what makes receiving **partial by default**: a supplier
 * ships six of ten and the order stays `placed` with four still on the way,
 * which is the common case and the one a single boolean cannot express.
 *
 * Real `references()` rather than the bare-`text` foreign keys the findings
 * flagged elsewhere in this schema: `restrict` on the item, because an item
 * that something is on order for is not a candidate for deletion.
 */
export const purchaseOrderLine = sqliteTable(
	'purchase_order_line',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => purchaseOrder.id, { onDelete: 'cascade' }),
		itemId: text('item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'restrict' }),
		quantityOrdered: integer('quantity_ordered').notNull(),
		/** An estimate at order time; the acquisition records what was actually paid. */
		unitCostCents: integer('unit_cost_cents'),
		quantityReceived: integer('quantity_received').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_po_line_order').on(t.orderId),
		index('idx_po_line_item').on(t.itemId),
		check('po_line_qty_positive', sql`quantity_ordered > 0`),
		check('po_line_received_sane', sql`quantity_received >= 0`)
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

/**
 * A how-to article that belongs with an item.
 *
 * Tutorials are `help_article` rows rather than a second body of prose: they
 * already carry publish state, a minimum role, a category and a sync path from
 * `src/content/help/`. This table only says *which* of them belong to which
 * item, which is the one fact the help system cannot hold on its own.
 *
 * Item-level rather than asset-level on purpose — "how to run the PA" is the
 * same article for all four K12.2s.
 */
export const inventoryItemArticle = sqliteTable(
	'inventory_item_article',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		itemId: text('item_id')
			.notNull()
			.references(() => inventoryItem.id, { onDelete: 'cascade' }),
		articleId: text('article_id').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_item_article_item').on(t.itemId),
		// One link per pair: adding the same article twice is a mis-click, not a
		// second association.
		unique('uniq_item_article').on(t.itemId, t.articleId)
	]
);

export type InventoryItemArticle = typeof inventoryItemArticle.$inferSelect;

/**
 * A **work request**: something a person noticed about one unit, not yet
 * authorized — the CMMS term (docs/specs/project-spec.md#vocabulary). Triage
 * turns it into a `work_order`, and N requests may collapse onto one.
 *
 * Shaped after `content_flag` and sharing its `flagStatuses` verbatim — one
 * lifecycle, one vocabulary — but deliberately **not** that table: gear must
 * not queue beside a harassment report. Renamed from `asset_flag`, which read
 * as a sibling of `content_flag`; index names keep the old prefix because
 * SQLite carries them through `RENAME TO` untouched.
 *
 * This is the half the ledger cannot carry. `stock_movement` records what
 * happened *to the asset*, and a movement has to move something — so it can say
 * "went out for repair" but not "three people noticed" or "noticed, still
 * usable". Both survive: a flag that takes the unit out of service still writes
 * its `repair_out`.
 */
export const workRequest = sqliteTable(
	'work_request',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// The subject is always one unit, so this is a real FK rather than the
		// polymorphic entityType/entityId `content_flag` needs. Cascade: a flag
		// about a row that no longer exists is noise, not history — the history
		// lives in the ledger, which outlives the asset by design.
		assetId: text('asset_id')
			.notNull()
			.references(() => inventoryAsset.id, { onDelete: 'cascade' }),

		// set-null, matching contentFlag.reportedByUserId: a deleted account must
		// not take the report with it.
		reportedByUserId: text('reported_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		note: text('note').notNull(),

		/** What the reporter thought, when they were willing to say. "Not sure" is null. */
		condition: text('condition', { enum: equipmentConditions }),

		/**
		 * Whether this makes the unit unrentable — the health axis that
		 * `asset.status` projects at the moment custody comes back.
		 *
		 * Set from the reporter's "is it still usable?", and editable at triage,
		 * because a member may say it is fine and staff may disagree on seeing the
		 * photo. A torn tolex is worth knowing and does not stop anybody playing.
		 */
		blocksUse: integer('blocks_use', { mode: 'boolean' }).notNull().default(false),

		status: text('status', { enum: flagStatuses }).notNull().default('pending'),
		resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		resolutionNotes: text('resolution_notes'),
		resolvedAt: integer('resolved_at', { mode: 'timestamp' }),

		// The work order answering this flag — N flags collapse onto one. No
		// `references()`: the target lives in `volunteer.ts`, which already points
		// here for its `assetId`, and a real FK would make the two schema modules
		// import each other. Same call as `acquisition.purchaseOrderId` above; the
		// service validates the target.
		workOrderId: text('work_order_id'),

		// Set when the flag is raised at re-uptake, so a damage conversation with
		// the borrower has the link. Set-null: the flag outlives the loan record.
		loanId: text('loan_id').references(() => inventoryLoan.id, { onDelete: 'set null' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_asset_flag_status').on(t.status),
		index('idx_asset_flag_asset').on(t.assetId),
		// "May this unit go out?" — asked on every return and every availability
		// check, and answered without touching the resolved pile.
		index('idx_asset_flag_open_blocking')
			.on(t.assetId)
			.where(sql`status = 'pending' and blocks_use = 1`),
		index('idx_asset_flag_work_order')
			.on(t.workOrderId)
			.where(sql`work_order_id is not null`)
	]
);

export type WorkRequest = typeof workRequest.$inferSelect;

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
