import { db } from '#lib/server/db/index.js';
import { inventoryItem, purchaseOrderLine } from '#lib/server/db/schema/inventory.js';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
	closeSourcedTasks,
	openSourceIds,
	openSourcedTask
} from '#lib/server/task/sourced-tasks.js';

/**
 * Restock tasks (#2756). An item at or below its reorder point, with nothing on
 * a placed order, has one open task; a placed order or stock back above the
 * point closes it. Run where stock or an order changes, and daily over every
 * item. Reads the ledger and orders directly: their services both call this.
 */
export async function syncRestockTasks(itemIds?: string[]): Promise<{
	opened: number;
	closed: number;
}> {
	if (itemIds?.length === 0) return { opened: 0, closed: 0 };

	// Qualified in full: drizzle leaves a lone table's columns bare, which
	// inside these subqueries would read the inner table's own `id`.
	const onHand = sql<number>`coalesce((
		select sum(m."quantity") from "stock_movement" m
		where m."item_id" = "inventory_item"."id"
	), 0)`;
	const onOrder = sql<number>`coalesce((
		select sum(l."quantity_ordered" - l."quantity_received")
		from "purchase_order_line" l
		inner join "purchase_order" o on o."id" = l."order_id"
		where l."item_id" = "inventory_item"."id"
			and o."status" = 'placed'
			and l."quantity_ordered" > l."quantity_received"
	), 0)`;

	const rows = await db
		.select({ id: inventoryItem.id, name: inventoryItem.name, onHand, onOrder })
		.from(inventoryItem)
		.where(
			and(
				itemIds ? inArray(inventoryItem.id, itemIds) : undefined,
				isNull(inventoryItem.deletedAt),
				isNotNull(inventoryItem.reorderPoint),
				sql`${onHand} <= ${inventoryItem.reorderPoint}`
			)
		);

	const open = await openSourceIds('restock', itemIds);
	const low = new Map(rows.map((r) => [r.id, r]));

	let opened = 0;
	for (const r of rows) {
		if (Number(r.onOrder) > 0 || open.has(r.id)) continue;
		const task = await openSourcedTask({
			source: 'restock',
			sourceId: r.id,
			title: `Restock ${r.name}`,
			links: { itemId: r.id }
		});
		if (task.opened) opened++;
	}

	const ordered = [...open.keys()].filter((id) => Number(low.get(id)?.onOrder ?? 0) > 0);
	const stocked = [...open.keys()].filter((id) => !low.has(id));
	const closed =
		(await closeSourcedTasks('restock', ordered, 'Closed: a purchase order was placed.')) +
		(await closeSourcedTasks('restock', stocked, 'Closed: the item is above its reorder point.'));
	return { opened, closed };
}

/** `afterStockChange` for the items on one purchase order, whose status just moved. */
export async function afterOrderChange(orderId: string) {
	const lines = await db
		.select({ itemId: purchaseOrderLine.itemId })
		.from(purchaseOrderLine)
		.where(eq(purchaseOrderLine.orderId, orderId));
	await afterStockChange(lines.map((l) => l.itemId));
}

/**
 * `syncRestockTasks` after a write that has already landed: a failure here is
 * logged, never thrown, so the stock or order change still reads as done. The
 * daily sweep catches what it missed.
 */
export async function afterStockChange(itemIds: (string | null | undefined)[]) {
	const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
	try {
		await syncRestockTasks(ids);
	} catch (err) {
		console.error('[restock-tasks] sync failed:', err);
	}
}
