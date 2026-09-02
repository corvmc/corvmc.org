import { db } from '$lib/server/db';
import { onOrderQuantities } from './order-service';
import {
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryLoan,
	stockMovement,
	STOCK_REASON_SIGN,
	type StockReason
} from '$lib/server/db/schema/inventory';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * The ledger.
 *
 * **Stock is a ledger, not a number.** Every change to what the collective
 * physically holds is an append-only `stock_movement` row, and on-hand is the
 * sum of those rows — never a stored figure. Nothing outside this file writes
 * to `stock_movement`, and nothing anywhere writes a quantity directly.
 *
 * The old `equipment.totalQuantity` was a number somebody typed, which is why
 * "how many packs of strings did we go through last quarter" was not a hard
 * question but an unanswerable one. See `docs/specs/inventory-spec.md`.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ItemNotFoundError extends Error {
	constructor() {
		super('Item not found');
		this.name = 'ItemNotFoundError';
	}
}

export class InsufficientStockError extends Error {
	constructor(
		public available: number,
		public requested: number
	) {
		super(`Only ${available} available, requested ${requested}`);
		this.name = 'InsufficientStockError';
	}
}

export class InvalidMovementError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidMovementError';
	}
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface RecordMovementInput {
	itemId: string;
	assetId?: string | null;
	/**
	 * The magnitude for a one-way reason, or the signed delta for `adjust`.
	 * A caller never chooses the sign of a `receive` or a `consume` — see
	 * `STOCK_REASON_SIGN`.
	 */
	quantity: number;
	reason: StockReason;
	locationId?: string | null;
	toLocationId?: string | null;
	actorId?: string | null;
	occurredAt?: Date;
	loanId?: string | null;
	acquisitionId?: string | null;
	notes?: string | null;
}

/**
 * The signed quantity a movement should carry.
 *
 * Split out and exported so the rule can be unit-tested as a pure function
 * rather than only through the database.
 */
export function signedQuantity(reason: StockReason, quantity: number): number {
	const sign = STOCK_REASON_SIGN[reason];

	if (sign === 0) {
		// `adjust` and `transfer` are the caller-signed reasons: a stocktake can
		// go either way, and a transfer is written as a matched pair.
		if (quantity === 0) {
			throw new InvalidMovementError(`A '${reason}' movement of zero changes nothing`);
		}
		return quantity;
	}

	if (quantity <= 0) {
		throw new InvalidMovementError(
			`'${reason}' takes a positive magnitude; its direction comes from the reason, not the caller`
		);
	}

	return sign * quantity;
}

/**
 * The insert a movement *is*, without running it.
 *
 * Split out from `recordMovement` so a caller whose movement is only half of
 * one fact — a status change, a checkout — can hand both halves to a single
 * `db.batch([...])` and have them land together or not at all. Written as two
 * awaits, a worker that dies in the gap leaves the other half standing alone,
 * and because on-hand is the ledger sum there is nothing left to notice it by.
 */
export function movementStatement(input: RecordMovementInput) {
	const quantity = signedQuantity(input.reason, input.quantity);

	return db
		.insert(stockMovement)
		.values({
			itemId: input.itemId,
			assetId: input.assetId ?? null,
			quantity,
			reason: input.reason,
			locationId: input.locationId ?? null,
			toLocationId: input.toLocationId ?? null,
			actorId: input.actorId ?? null,
			occurredAt: input.occurredAt ?? new Date(),
			loanId: input.loanId ?? null,
			acquisitionId: input.acquisitionId ?? null,
			notes: input.notes ?? null
		})
		.returning();
}

/** Write one movement on its own, when nothing else has to land with it. */
export async function recordMovement(input: RecordMovementInput) {
	const [row] = await movementStatement(input);
	return row;
}

/**
 * Move stock between locations.
 *
 * Written as a **matched pair** — `-n` at the origin, `+n` at the destination —
 * so a transfer nets to zero in every on-hand sum without any query having to
 * remember to exclude it. The alternative (one row, filtered out everywhere)
 * puts the correctness burden on every future caller.
 */
export async function transferStock(input: {
	itemId: string;
	assetId?: string | null;
	quantity: number;
	fromLocationId: string;
	toLocationId: string;
	actorId?: string | null;
	notes?: string | null;
}) {
	if (input.quantity <= 0) {
		throw new InvalidMovementError('A transfer needs a positive quantity');
	}
	if (input.fromLocationId === input.toLocationId) {
		throw new InvalidMovementError('A transfer needs two different locations');
	}

	const occurredAt = new Date();
	const base = {
		itemId: input.itemId,
		assetId: input.assetId ?? null,
		reason: 'transfer' as const,
		actorId: input.actorId ?? null,
		occurredAt,
		notes: input.notes ?? null
	};

	// db.batch, never db.transaction — the latter is broken on D1.
	const rows = await db.batch([
		db
			.insert(stockMovement)
			.values({
				...base,
				quantity: -input.quantity,
				locationId: input.fromLocationId,
				toLocationId: input.toLocationId
			})
			.returning(),
		db
			.insert(stockMovement)
			.values({
				...base,
				quantity: input.quantity,
				locationId: input.toLocationId,
				toLocationId: null
			})
			.returning()
	]);

	if (input.assetId) {
		await db
			.update(inventoryAsset)
			.set({ locationId: input.toLocationId, updatedAt: new Date() })
			.where(eq(inventoryAsset.id, input.assetId));
	}

	return rows.flat();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** On-hand for one item: the sum of its ledger, and nothing else. */
export async function getOnHand(itemId: string): Promise<number> {
	const [row] = await db
		.select({ onHand: sql<number>`COALESCE(SUM(${stockMovement.quantity}), 0)` })
		.from(stockMovement)
		.where(eq(stockMovement.itemId, itemId));

	return Number(row?.onHand ?? 0);
}

/** On-hand for many items at once, so a list page is one query and not N. */
export async function getOnHandMany(itemIds: string[]): Promise<Map<string, number>> {
	if (itemIds.length === 0) return new Map();

	const rows = await db
		.select({
			itemId: stockMovement.itemId,
			onHand: sql<number>`COALESCE(SUM(${stockMovement.quantity}), 0)`
		})
		.from(stockMovement)
		.where(inArray(stockMovement.itemId, itemIds))
		.groupBy(stockMovement.itemId);

	const out = new Map<string, number>(itemIds.map((id) => [id, 0]));
	for (const row of rows) out.set(row.itemId, Number(row.onHand));
	return out;
}

/**
 * Quantity reserved by loans that have not yet left the building.
 *
 * A `scheduled` loan has no `loan_out` movement yet — the gear is still on the
 * shelf — but it is spoken for, so it has to come off availability. Once a loan
 * is `checked_out` the ledger has already decremented it and counting it again
 * here would double-count.
 */
async function reservedQuantity(itemId: string): Promise<number> {
	const [row] = await db
		.select({ qty: sql<number>`COALESCE(SUM(${inventoryLoan.quantity}), 0)` })
		.from(inventoryLoan)
		.where(and(eq(inventoryLoan.itemId, itemId), eq(inventoryLoan.status, 'scheduled')));

	return Number(row?.qty ?? 0);
}

/**
 * What could go out of the door right now.
 *
 * For a `bulk` item that is on-hand less what is already promised. For a
 * `serialized` item it is the count of units actually in service, which is the
 * stronger statement — an amp in `maintenance` is on-hand and unavailable, and
 * only the per-unit status knows that.
 */
export async function getAvailableQuantity(itemId: string): Promise<number> {
	const [item] = await db
		.select({ kind: inventoryItem.kind })
		.from(inventoryItem)
		.where(and(eq(inventoryItem.id, itemId), isNull(inventoryItem.deletedAt)))
		.limit(1);

	if (!item) return 0;

	const reserved = await reservedQuantity(itemId);

	if (item.kind === 'serialized') {
		const [row] = await db
			.select({ n: sql<number>`COUNT(*)` })
			.from(inventoryAsset)
			.where(and(eq(inventoryAsset.itemId, itemId), eq(inventoryAsset.status, 'in_service')));
		return Math.max(0, Number(row?.n ?? 0) - reserved);
	}

	return Math.max(0, (await getOnHand(itemId)) - reserved);
}

export interface ListMovementsOptions {
	itemId?: string;
	assetId?: string;
	limit?: number;
}

export async function listMovements(opts: ListMovementsOptions = {}) {
	const conditions = [];
	if (opts.itemId) conditions.push(eq(stockMovement.itemId, opts.itemId));
	if (opts.assetId) conditions.push(eq(stockMovement.assetId, opts.assetId));

	return db
		.select()
		.from(stockMovement)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(stockMovement.occurredAt), desc(stockMovement.createdAt))
		.limit(opts.limit ?? 100);
}

/**
 * Bulk items that have fallen to or below their reorder point.
 *
 * The whole point of the reorder point is that nobody has to notice, so this is
 * a query the staff dashboard runs rather than something a person remembers to
 * check.
 */
export async function listLowStock() {
	const onHand = db
		.select({
			itemId: stockMovement.itemId,
			qty: sql<number>`COALESCE(SUM(${stockMovement.quantity}), 0)`.as('qty')
		})
		.from(stockMovement)
		.groupBy(stockMovement.itemId)
		.as('on_hand');

	const rows = await db
		.select({
			item: inventoryItem,
			category: equipmentCategory,
			onHand: sql<number>`COALESCE(${onHand.qty}, 0)`
		})
		.from(inventoryItem)
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.leftJoin(onHand, eq(inventoryItem.id, onHand.itemId))
		.where(
			and(
				isNull(inventoryItem.deletedAt),
				sql`${inventoryItem.reorderPoint} IS NOT NULL`,
				sql`COALESCE(${onHand.qty}, 0) <= ${inventoryItem.reorderPoint}`
			)
		)
		// Emptiest first: the shopping list should open on whatever ran out, not
		// on whatever happens to sort first alphabetically.
		.orderBy(sql`COALESCE(${onHand.qty}, 0) - ${inventoryItem.reorderPoint}`, inventoryItem.name);

	/**
	 * What is already on the way, so the list stops asking twice.
	 *
	 * This is the concrete cost of having had no order state: buy ten packs of
	 * strings on Monday and this list said "out — buy 10" all week, because
	 * nothing could tell *"we are out"* from *"we are out but ten arrive
	 * Thursday"*. One extra query for the whole page, not one per row.
	 */
	const onOrder = await onOrderQuantities(rows.map((r) => r.item.id));

	return rows.map((r) => ({
		...r.item,
		category: r.category,
		onHand: Number(r.onHand),
		onOrder: onOrder.get(r.item.id) ?? 0,
		/**
		 * How many to buy. The reorder quantity is the intended order size, so it
		 * wins where one is set; without it, buy back up to the point. Never less
		 * than one — an item at exactly its point is on the list precisely because
		 * it needs restocking.
		 */
		/**
		 * How many to buy *now*. The reorder quantity is the intended order size,
		 * so it wins where one is set; without it, buy back up to the point. What
		 * is already on order comes off the top, and a row whose shortfall is
		 * fully covered suggests nothing rather than a misleading zero.
		 */
		suggestedOrder: Math.max(
			0,
			Math.max(1, r.item.reorderQuantity ?? (r.item.reorderPoint ?? 0) - Number(r.onHand)) -
				(onOrder.get(r.item.id) ?? 0)
		),
		isOut: Number(r.onHand) <= 0
	}));
}
