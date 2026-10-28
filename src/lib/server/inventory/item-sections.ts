/**
 * The item page's views onto records that span several items: the orders it is
 * on, the problems reported against its units, and the arrivals that brought it
 * in (#1841). Each reads one item's slice of a table that has its own list.
 */

import { db } from '$lib/server/db';
import {
	acquisition,
	acquisitionLine,
	inventoryAsset,
	purchaseOrder,
	purchaseOrderLine,
	workRequest
} from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

/**
 * Lines still owed on `placed` orders, soonest first. The same rule as
 * `onOrderQuantities`: a draft is not coming yet and a cancelled order never will.
 */
export async function openOrderLinesForItem(itemId: string) {
	const rows = await db
		.select({
			lineId: purchaseOrderLine.id,
			orderId: purchaseOrder.id,
			supplierName: purchaseOrder.supplierName,
			reference: purchaseOrder.reference,
			placedAt: purchaseOrder.placedAt,
			expectedAt: purchaseOrder.expectedAt,
			quantityOrdered: purchaseOrderLine.quantityOrdered,
			quantityReceived: purchaseOrderLine.quantityReceived
		})
		.from(purchaseOrderLine)
		.innerJoin(purchaseOrder, eq(purchaseOrderLine.orderId, purchaseOrder.id))
		.where(
			and(
				eq(purchaseOrderLine.itemId, itemId),
				eq(purchaseOrder.status, 'placed'),
				sql`${purchaseOrderLine.quantityOrdered} > ${purchaseOrderLine.quantityReceived}`
			)
		)
		// SQLite sorts nulls first; an order with no date goes after the dated ones.
		.orderBy(sql`${purchaseOrder.expectedAt} IS NULL`, asc(purchaseOrder.expectedAt));

	return rows.map((r) => ({ ...r, outstanding: r.quantityOrdered - r.quantityReceived }));
}

/** Reports on this item's units that nobody has closed yet, newest first. */
export async function openProblemsForItem(itemId: string) {
	return db
		.select({
			id: workRequest.id,
			note: workRequest.note,
			blocksUse: workRequest.blocksUse,
			inWorkOrder: sql<boolean>`${workRequest.workOrderId} IS NOT NULL`.mapWith(Boolean),
			createdAt: workRequest.createdAt,
			assetId: inventoryAsset.id,
			assetTag: inventoryAsset.assetTag,
			serialNumber: inventoryAsset.serialNumber
		})
		.from(workRequest)
		.innerJoin(inventoryAsset, eq(workRequest.assetId, inventoryAsset.id))
		.where(and(eq(inventoryAsset.itemId, itemId), eq(workRequest.status, 'pending')))
		.orderBy(desc(workRequest.createdAt));
}

/**
 * All three, for `getStaffItemDetail`. Orders and acquisitions are `inventory.read`
 * like the item; reports name their reporter and are `inventory.manageAssets`, as
 * on the queue, so a viewer without it gets `null` rather than an empty list.
 */
export async function itemSections(itemId: string, opts: { canTriage: boolean }) {
	const [onOrder, problems, sources] = await Promise.all([
		openOrderLinesForItem(itemId),
		opts.canTriage ? openProblemsForItem(itemId) : null,
		sourcesForItem(itemId)
	]);
	return { onOrder, problems, sources };
}

/** One row per acquisition line for this item, newest first. */
export async function sourcesForItem(itemId: string) {
	const rows = await db
		.select({
			lineId: acquisitionLine.id,
			acquisitionId: acquisition.id,
			kind: acquisition.kind,
			occurredAt: acquisition.occurredAt,
			sourceName: acquisition.sourceName,
			donorUserId: acquisition.donorUserId,
			donorName: user.name,
			quantity: acquisitionLine.quantity,
			unitValueCents: acquisitionLine.unitValueCents
		})
		.from(acquisitionLine)
		.innerJoin(acquisition, eq(acquisitionLine.acquisitionId, acquisition.id))
		.leftJoin(user, eq(acquisition.donorUserId, user.id))
		.where(eq(acquisitionLine.itemId, itemId))
		.orderBy(desc(acquisition.occurredAt));

	// The same source rule as `listAcquisitions`: a member donor's name, else the free text.
	return rows.map(({ donorUserId, donorName, ...r }) => ({
		...r,
		source: donorUserId ? donorName : r.sourceName
	}));
}
