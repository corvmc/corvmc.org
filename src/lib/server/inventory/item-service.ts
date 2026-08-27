import { db } from '$lib/server/db';
import {
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryLocation
} from '$lib/server/db/schema/inventory';
import { and, count, eq, isNull, like, or, sql } from 'drizzle-orm';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { getAvailableQuantity, getOnHandMany } from './stock-service';
import type { ItemKind, PricingTier, UnitOfMeasure } from '$lib/config';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ItemNotFoundError extends Error {
	constructor() {
		super('Item not found');
		this.name = 'ItemNotFoundError';
	}
}

export class CategoryNotFoundError extends Error {
	constructor() {
		super('Category not found');
		this.name = 'CategoryNotFoundError';
	}
}

export class CategoryHasItemsError extends Error {
	constructor() {
		super('Cannot delete category that has items assigned');
		this.name = 'CategoryHasItemsError';
	}
}

export class LocationNotFoundError extends Error {
	constructor() {
		super('Location not found');
		this.name = 'LocationNotFoundError';
	}
}

// ---------------------------------------------------------------------------
// Category CRUD — carried over unchanged; the pricing tier still lives here.
// ---------------------------------------------------------------------------

export async function createCategory(data: {
	name: string;
	displayOrder?: number;
	pricingTier: PricingTier;
}) {
	const [row] = await db
		.insert(equipmentCategory)
		.values({
			name: data.name,
			displayOrder: data.displayOrder ?? 0,
			pricingTier: data.pricingTier
		})
		.returning();
	return row;
}

export async function updateCategory(
	id: string,
	data: { name?: string; displayOrder?: number; pricingTier?: PricingTier }
) {
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updates.name = data.name;
	if (data.displayOrder !== undefined) updates.displayOrder = data.displayOrder;
	if (data.pricingTier !== undefined) updates.pricingTier = data.pricingTier;

	const [row] = await db
		.update(equipmentCategory)
		.set(updates)
		.where(eq(equipmentCategory.id, id))
		.returning();

	if (!row) throw new CategoryNotFoundError();
	return row;
}

export async function deleteCategory(id: string) {
	const [hasItems] = await db
		.select({ id: inventoryItem.id })
		.from(inventoryItem)
		.where(and(eq(inventoryItem.categoryId, id), isNull(inventoryItem.deletedAt)))
		.limit(1);

	if (hasItems) throw new CategoryHasItemsError();

	const [row] = await db.delete(equipmentCategory).where(eq(equipmentCategory.id, id)).returning();

	if (!row) throw new CategoryNotFoundError();
	return row;
}

export async function listCategories() {
	return db
		.select()
		.from(equipmentCategory)
		.orderBy(equipmentCategory.displayOrder, equipmentCategory.name);
}

export async function getCategoryById(id: string) {
	const [row] = await db
		.select()
		.from(equipmentCategory)
		.where(eq(equipmentCategory.id, id))
		.limit(1);
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Location CRUD
// ---------------------------------------------------------------------------

export async function createLocation(data: {
	name: string;
	parentId?: string;
	displayOrder?: number;
	notes?: string;
}) {
	const [row] = await db
		.insert(inventoryLocation)
		.values({
			name: data.name,
			parentId: data.parentId ?? null,
			displayOrder: data.displayOrder ?? 0,
			notes: data.notes ?? null
		})
		.returning();
	return row;
}

export async function listLocations() {
	return db
		.select()
		.from(inventoryLocation)
		.orderBy(inventoryLocation.displayOrder, inventoryLocation.name);
}

// ---------------------------------------------------------------------------
// Item CRUD
// ---------------------------------------------------------------------------

export interface CreateItemData {
	name: string;
	description?: string;
	categoryId: string;
	kind: ItemKind;
	unitOfMeasure?: UnitOfMeasure;
	gtin?: string;
	isLoanable?: boolean;
	reorderPoint?: number;
	reorderQuantity?: number;
	resourceId?: string;
	notes?: string;
}

export async function createItem(data: CreateItemData) {
	const [row] = await db
		.insert(inventoryItem)
		.values({
			name: data.name,
			description: data.description ?? null,
			categoryId: data.categoryId,
			kind: data.kind,
			unitOfMeasure: data.unitOfMeasure ?? 'each',
			gtin: data.gtin ?? null,
			isLoanable: data.isLoanable ?? true,
			// A reorder point on a serialized item would be meaningless — you do
			// not restock Les Pauls to a par level. The check constraint agrees.
			reorderPoint: data.kind === 'bulk' ? (data.reorderPoint ?? null) : null,
			reorderQuantity: data.kind === 'bulk' ? (data.reorderQuantity ?? null) : null,
			resourceId: data.resourceId ?? null,
			notes: data.notes ?? null
		})
		.returning();
	return row;
}

export async function updateItem(id: string, data: Partial<CreateItemData>) {
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updates.name = data.name;
	if (data.description !== undefined) updates.description = data.description || null;
	if (data.categoryId !== undefined) updates.categoryId = data.categoryId;
	if (data.unitOfMeasure !== undefined) updates.unitOfMeasure = data.unitOfMeasure;
	if (data.gtin !== undefined) updates.gtin = data.gtin || null;
	if (data.isLoanable !== undefined) updates.isLoanable = data.isLoanable;
	if (data.reorderPoint !== undefined) updates.reorderPoint = data.reorderPoint ?? null;
	if (data.reorderQuantity !== undefined) updates.reorderQuantity = data.reorderQuantity ?? null;
	if (data.resourceId !== undefined) updates.resourceId = data.resourceId || null;
	if (data.notes !== undefined) updates.notes = data.notes || null;

	// `kind` is deliberately not updatable: flipping a serialized item to bulk
	// would orphan its assets, and flipping the other way would invent units
	// that were never counted. Create the right item instead.

	const [row] = await db
		.update(inventoryItem)
		.set(updates)
		.where(and(eq(inventoryItem.id, id), isNull(inventoryItem.deletedAt)))
		.returning();

	if (!row) throw new ItemNotFoundError();
	return row;
}

export async function softDeleteItem(id: string) {
	const [row] = await db
		.update(inventoryItem)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(inventoryItem.id, id), isNull(inventoryItem.deletedAt)))
		.returning();

	if (!row) throw new ItemNotFoundError();
	return row;
}

export async function restoreItem(id: string) {
	const [row] = await db
		.update(inventoryItem)
		.set({ deletedAt: null, updatedAt: new Date() })
		.where(eq(inventoryItem.id, id))
		.returning();

	if (!row) throw new ItemNotFoundError();
	return row;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * `includeDeleted` exists for staff: deactivation is a soft delete, and without
 * it the detail page 404s on the very rows whose Reactivate button lives there.
 */
export async function getItemById(id: string, opts: { includeDeleted?: boolean } = {}) {
	const [row] = await db
		.select({ item: inventoryItem, category: equipmentCategory })
		.from(inventoryItem)
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.where(
			opts.includeDeleted
				? eq(inventoryItem.id, id)
				: and(eq(inventoryItem.id, id), isNull(inventoryItem.deletedAt))
		)
		.limit(1);

	if (!row) return null;

	const [onHand, available, assetCount] = await Promise.all([
		getOnHandMany([id]).then((m) => m.get(id) ?? 0),
		getAvailableQuantity(id),
		db
			.select({ n: count() })
			.from(inventoryAsset)
			.where(eq(inventoryAsset.itemId, id))
			.then(([r]) => Number(r?.n ?? 0))
	]);

	return {
		...row.item,
		category: row.category,
		onHand,
		availableQuantity: available,
		assetCount,
		/** Both derived, never stored — see the `kind` note in the schema. */
		isConsumable: row.item.kind === 'bulk' && !row.item.isLoanable,
		isLowStock: row.item.reorderPoint != null && onHand <= row.item.reorderPoint
	};
}

export interface ListItemsOptions {
	search?: string;
	categoryId?: string;
	kind?: ItemKind;
	loanableOnly?: boolean;
	includeDeleted?: boolean;
}

export async function listItems(opts: ListItemsOptions = {}, pagination: PaginationInput = {}) {
	const conditions = [];

	if (!opts.includeDeleted) conditions.push(isNull(inventoryItem.deletedAt));
	if (opts.categoryId) conditions.push(eq(inventoryItem.categoryId, opts.categoryId));
	if (opts.kind) conditions.push(eq(inventoryItem.kind, opts.kind));
	if (opts.loanableOnly) conditions.push(eq(inventoryItem.isLoanable, true));
	if (opts.search) {
		conditions.push(
			or(
				like(inventoryItem.name, `%${opts.search}%`),
				like(inventoryItem.gtin, `%${opts.search}%`),
				like(inventoryItem.resourceId, `%${opts.search}%`)
			)
		);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const dataQ = db
		.select({ item: inventoryItem, category: equipmentCategory })
		.from(inventoryItem)
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.where(where)
		.orderBy(equipmentCategory.displayOrder, inventoryItem.name)
		.$dynamic();

	const countQ = db.select({ count: count() }).from(inventoryItem).where(where);

	const result = await paginate(dataQ, countQ, pagination);

	// One grouped query for the page rather than a sum per row — the fan-out
	// rule in docs/checklists/remote-query-fanout.md.
	const onHand = await getOnHandMany(result.rows.map((r) => r.item.id));

	// In-service counts for the serialized rows, again in one query.
	const serializedIds = result.rows
		.filter((r) => r.item.kind === 'serialized')
		.map((r) => r.item.id);
	const inService = new Map<string, number>();
	if (serializedIds.length > 0) {
		const counts = await db
			.select({ itemId: inventoryAsset.itemId, n: sql<number>`COUNT(*)` })
			.from(inventoryAsset)
			.where(and(eq(inventoryAsset.status, 'in_service')))
			.groupBy(inventoryAsset.itemId);
		for (const c of counts) inService.set(c.itemId, Number(c.n));
	}

	return {
		...result,
		rows: result.rows.map((row) => ({
			...row.item,
			category: row.category,
			onHand: onHand.get(row.item.id) ?? 0,
			availableQuantity:
				row.item.kind === 'serialized'
					? (inService.get(row.item.id) ?? 0)
					: (onHand.get(row.item.id) ?? 0),
			isConsumable: row.item.kind === 'bulk' && !row.item.isLoanable,
			isLowStock:
				row.item.reorderPoint != null && (onHand.get(row.item.id) ?? 0) <= row.item.reorderPoint
		}))
	};
}
