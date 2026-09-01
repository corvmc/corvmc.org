import { db } from '$lib/server/db';
import {
	acquisition,
	equipmentCategory,
	inventoryItem,
	purchaseOrder,
	purchaseOrderLine
} from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import type { OrderStatus } from '$lib/config';

/**
 * Purchase orders — what the collective has decided to buy, before it exists.
 *
 * Kept apart from `acquisition` on purpose. An acquisition means *goods
 * arrived*, and that is the rule every `receive` movement and every money
 * report leans on. An order means *goods were promised*, which is a different
 * claim with a different lifetime, and folding the two together would have made
 * `spendByCategory` start counting money for things still in a van.
 *
 * The thing this actually fixes is duplicate buying: `listLowStock` now
 * subtracts what is already on order, so the restock list stops asking you to
 * buy what is coming on Thursday.
 */

export class OrderNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Order not found');
	}
}

export class OrderStateError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
	}
}

export interface OrderLineInput {
	itemId: string;
	quantityOrdered: number;
	unitCostCents?: number;
}

export interface CreateOrderData {
	supplierName?: string;
	reference?: string;
	expectedAt?: Date;
	notes?: string;
	createdByUserId?: string;
	lines: OrderLineInput[];
}

export async function createOrder(data: CreateOrderData) {
	if (data.lines.length === 0) {
		throw new OrderStateError('An order needs at least one line');
	}

	const orderId = crypto.randomUUID();

	// `db.batch`, never `db.transaction()` — broken on D1. The header has to be
	// written before the lines that reference it, and a batch runs in order.
	await db.batch([
		db.insert(purchaseOrder).values({
			id: orderId,
			status: 'draft',
			supplierName: data.supplierName ?? null,
			reference: data.reference ?? null,
			expectedAt: data.expectedAt ?? null,
			notes: data.notes ?? null,
			createdByUserId: data.createdByUserId ?? null
		}),
		db.insert(purchaseOrderLine).values(
			data.lines.map((l) => ({
				id: crypto.randomUUID(),
				orderId,
				itemId: l.itemId,
				quantityOrdered: l.quantityOrdered,
				unitCostCents: l.unitCostCents ?? null
			}))
		)
	] as unknown as Parameters<typeof db.batch>[0]);

	return orderId;
}

/** Draft → placed. This is the moment the restock list stops asking. */
export async function placeOrder(id: string, when: Date = new Date()) {
	const order = await requireOrder(id);
	if (order.status !== 'draft') {
		throw new OrderStateError(`An order that is already ${order.status} cannot be placed`);
	}

	await db
		.update(purchaseOrder)
		.set({ status: 'placed', placedAt: when, updatedAt: new Date() })
		.where(eq(purchaseOrder.id, id));
}

/**
 * Cancelling an order that was never fully received.
 *
 * Allowed from `draft` and `placed` and nowhere else: a received order is a
 * historical fact, and the acquisition hanging off it is the proof.
 */
export async function cancelOrder(id: string) {
	const order = await requireOrder(id);
	if (order.status === 'received') {
		throw new OrderStateError('An order that has been received cannot be cancelled');
	}

	await db
		.update(purchaseOrder)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(eq(purchaseOrder.id, id));
}

async function requireOrder(id: string) {
	const [row] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, id)).limit(1);
	if (!row) throw new OrderNotFoundError();
	return row;
}

export async function listOrders(opts: { status?: OrderStatus } = {}) {
	const conditions = [];
	if (opts.status) conditions.push(eq(purchaseOrder.status, opts.status));

	const orders = await db
		.select({ order: purchaseOrder, createdBy: user })
		.from(purchaseOrder)
		.leftJoin(user, eq(purchaseOrder.createdByUserId, user.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		// Open ones first, then most recent — the list is a worklist, not an archive.
		.orderBy(
			sql`CASE ${purchaseOrder.status} WHEN 'placed' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END`,
			desc(purchaseOrder.createdAt)
		);

	if (orders.length === 0) return [];

	// One query for every line, then grouped in memory — not one query per order.
	const lines = await db
		.select({ line: purchaseOrderLine, item: inventoryItem })
		.from(purchaseOrderLine)
		.innerJoin(inventoryItem, eq(purchaseOrderLine.itemId, inventoryItem.id))
		.where(
			inArray(
				purchaseOrderLine.orderId,
				orders.map((o) => o.order.id)
			)
		);

	const byOrder = new Map<string, typeof lines>();
	for (const row of lines) {
		const list = byOrder.get(row.line.orderId) ?? [];
		list.push(row);
		byOrder.set(row.line.orderId, list);
	}

	return orders.map((o) => {
		const own = byOrder.get(o.order.id) ?? [];
		const ordered = own.reduce((n, r) => n + r.line.quantityOrdered, 0);
		const received = own.reduce((n, r) => n + r.line.quantityReceived, 0);
		return {
			...o.order,
			createdByName: o.createdBy?.name ?? null,
			lines: own.map((r) => ({ ...r.line, item: r.item })),
			quantityOrdered: ordered,
			quantityReceived: received,
			/** Fully received, whatever the status column happens to say. */
			isComplete: ordered > 0 && received >= ordered,
			estimatedTotalCents: own.reduce(
				(n, r) => n + (r.line.unitCostCents ?? 0) * r.line.quantityOrdered,
				0
			)
		};
	});
}

export async function getOrderById(id: string) {
	const [row] = await db
		.select({ order: purchaseOrder, createdBy: user })
		.from(purchaseOrder)
		.leftJoin(user, eq(purchaseOrder.createdByUserId, user.id))
		.where(eq(purchaseOrder.id, id))
		.limit(1);

	if (!row) return null;

	const lines = await db
		.select({ line: purchaseOrderLine, item: inventoryItem, category: equipmentCategory })
		.from(purchaseOrderLine)
		.innerJoin(inventoryItem, eq(purchaseOrderLine.itemId, inventoryItem.id))
		.leftJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.where(eq(purchaseOrderLine.orderId, id))
		.orderBy(asc(inventoryItem.name));

	// What arrived against this order, so the detail page can show the receipts
	// rather than just the promise.
	const arrivals = await db
		.select({ id: acquisition.id, occurredAt: acquisition.occurredAt })
		.from(acquisition)
		.where(eq(acquisition.purchaseOrderId, id))
		.orderBy(desc(acquisition.occurredAt));

	const ordered = lines.reduce((n, r) => n + r.line.quantityOrdered, 0);
	const received = lines.reduce((n, r) => n + r.line.quantityReceived, 0);

	return {
		...row.order,
		createdByName: row.createdBy?.name ?? null,
		lines: lines.map((r) => ({
			...r.line,
			item: r.item,
			category: r.category,
			outstanding: Math.max(0, r.line.quantityOrdered - r.line.quantityReceived)
		})),
		arrivals,
		quantityOrdered: ordered,
		quantityReceived: received,
		isComplete: ordered > 0 && received >= ordered,
		estimatedTotalCents: lines.reduce(
			(n, r) => n + (r.line.unitCostCents ?? 0) * r.line.quantityOrdered,
			0
		)
	};
}

/**
 * How much of each item is on the way.
 *
 * Only `placed` orders count. A draft is a shopping list somebody is still
 * writing, and a cancelled order is not coming — treating either as inbound
 * would suppress a restock suggestion for goods nobody ever ordered, which is
 * the same duplicate-buying failure in the opposite direction.
 */
export async function onOrderQuantities(itemIds?: string[]) {
	const conditions = [
		eq(purchaseOrder.status, 'placed'),
		sql`${purchaseOrderLine.quantityOrdered} > ${purchaseOrderLine.quantityReceived}`
	];
	if (itemIds?.length) conditions.push(inArray(purchaseOrderLine.itemId, itemIds));

	const rows = await db
		.select({
			itemId: purchaseOrderLine.itemId,
			qty: sql<number>`SUM(${purchaseOrderLine.quantityOrdered} - ${purchaseOrderLine.quantityReceived})`
		})
		.from(purchaseOrderLine)
		.innerJoin(purchaseOrder, eq(purchaseOrderLine.orderId, purchaseOrder.id))
		.where(and(...conditions))
		.groupBy(purchaseOrderLine.itemId);

	return new Map(rows.map((r) => [r.itemId, Number(r.qty)]));
}

/**
 * Record that some of an order turned up.
 *
 * **Partial by default.** A supplier ships six of ten and the order stays
 * `placed` with four outstanding, because that is the common case and the one a
 * boolean cannot express. It closes itself only when every line is fulfilled —
 * or when a human closes it short, which `closeOrderShort` is for.
 *
 * The acquisition is written by the intake path, not here: receiving *is*
 * intake, prefilled from the order, so the goods land through the same code
 * that every other arrival uses and the ledger cannot fork.
 */
export async function applyReceipt(input: {
	orderId: string;
	acquisitionId: string;
	received: { itemId: string; quantity: number }[];
}) {
	const order = await requireOrder(input.orderId);
	if (order.status === 'cancelled') {
		throw new OrderStateError('A cancelled order cannot receive goods');
	}

	const lines = await db
		.select()
		.from(purchaseOrderLine)
		.where(eq(purchaseOrderLine.orderId, input.orderId));

	const writes = [];
	for (const { itemId, quantity } of input.received) {
		const line = lines.find((l) => l.itemId === itemId);
		// An arrival can legitimately carry something that was never ordered —
		// the supplier substituted, or somebody added to the trip. It belongs on
		// the acquisition, which already has it, and simply not on the order.
		if (!line || quantity <= 0) continue;
		writes.push(
			db
				.update(purchaseOrderLine)
				.set({ quantityReceived: line.quantityReceived + quantity })
				.where(eq(purchaseOrderLine.id, line.id))
		);
	}

	// Link the arrival to the promise it fulfilled.
	writes.push(
		db
			.update(acquisition)
			.set({ purchaseOrderId: input.orderId })
			.where(eq(acquisition.id, input.acquisitionId))
	);

	if (writes.length > 0) {
		await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
	}

	// Re-read rather than compute from the values just written: another receipt
	// may have landed against the same order in between.
	const after = await db
		.select()
		.from(purchaseOrderLine)
		.where(eq(purchaseOrderLine.orderId, input.orderId));

	const complete = after.every((l) => l.quantityReceived >= l.quantityOrdered);
	if (complete && order.status !== 'received') {
		await db
			.update(purchaseOrder)
			.set({ status: 'received', updatedAt: new Date() })
			.where(eq(purchaseOrder.id, input.orderId));
	}

	return { complete };
}

/** "The rest is never coming." Closes an order with lines still outstanding. */
export async function closeOrderShort(id: string) {
	const order = await requireOrder(id);
	if (order.status !== 'placed') {
		throw new OrderStateError('Only a placed order can be closed short');
	}
	await db
		.update(purchaseOrder)
		.set({ status: 'received', updatedAt: new Date() })
		.where(eq(purchaseOrder.id, id));
}

/** Items on a placed order that is past its expected date. */
export async function listLateOrders(now: Date = new Date()) {
	const rows = await listOrders({ status: 'placed' });
	return rows.filter((o) => o.expectedAt && o.expectedAt < now && !o.isComplete);
}
