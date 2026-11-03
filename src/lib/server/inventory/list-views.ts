import { db } from '#lib/server/db/index.js';
import {
	inventoryAsset,
	inventoryLoan,
	purchaseOrder,
	purchaseOrderLine,
	workRequest
} from '#lib/server/db/schema/inventory.js';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { InventoryListView } from '#lib/config.js';

/**
 * The item ids a cross-item view on the Inventory list keeps, as a subquery for
 * `inArray`, never a list of ids: D1 caps a statement at 100 bound parameters.
 * `restock` has no entry because its rows come from `listLowStock`, grouped.
 */
export function itemIdsInView(view: Exclude<InventoryListView, 'restock'>, now: Date) {
	switch (view) {
		case 'on-order':
		case 'late':
			// The rule `onOrderQuantities` uses: only `placed` lines with something still owed.
			return db
				.select({ id: purchaseOrderLine.itemId })
				.from(purchaseOrderLine)
				.innerJoin(purchaseOrder, eq(purchaseOrderLine.orderId, purchaseOrder.id))
				.where(
					and(
						eq(purchaseOrder.status, 'placed'),
						sql`${purchaseOrderLine.quantityOrdered} > ${purchaseOrderLine.quantityReceived}`,
						view === 'late' ? lt(purchaseOrder.expectedAt, now) : undefined
					)
				);
		case 'on-loan':
		case 'overdue':
			return db
				.select({ id: sql<string>`${inventoryLoan.itemId}` })
				.from(inventoryLoan)
				.where(
					and(
						eq(inventoryLoan.status, 'checked_out'),
						isNull(inventoryLoan.returnedAt),
						isNotNull(inventoryLoan.itemId),
						view === 'overdue' ? lt(inventoryLoan.dueDate, now) : undefined
					)
				);
		case 'problems':
			return db
				.select({ id: inventoryAsset.itemId })
				.from(workRequest)
				.innerJoin(inventoryAsset, eq(workRequest.assetId, inventoryAsset.id))
				.where(eq(workRequest.status, 'pending'));
	}
}
