import { db } from '#lib/server/db/index.js';
import { workOrder } from '#lib/server/db/schema/volunteer.js';
import { workOrderLink, type NewWorkOrderLink } from '#lib/server/db/schema/work-order-link.js';
import {
	and,
	eq,
	getTableColumns,
	inArray,
	isNotNull,
	sql,
	type SQL,
	type SQLWrapper
} from 'drizzle-orm';

/**
 * Reading and writing `work_order_link` (#2622): what a task is about. Every
 * reader of "the task's unit" or "tasks about this booking" goes through here,
 * so the link table has one shape of query.
 */

export const linkTargets = ['organizationId', 'contactId', 'assetId', 'reservationId'] as const;
export type LinkTarget = (typeof linkTargets)[number];

export type LinkTo = Partial<Record<LinkTarget, string | null | undefined>>;

/** One insert per target set in `to`, for the caller's batch. */
export function linkInserts(workOrderId: string, to: LinkTo) {
	return linkTargets
		.filter((target) => to[target])
		.map((target) => {
			const row: NewWorkOrderLink = { workOrderId, [target]: to[target] };
			return db.insert(workOrderLink).values(row);
		});
}

/**
 * A link written only if the task exists by the time the batch reaches it: for
 * an insert that may be skipped on conflict, such as a recurring occurrence.
 */
export function linkInsertIfTaskExists(workOrderId: string, target: LinkTarget, id: string) {
	const values: Record<string, SQL> = {
		id: sql`${crypto.randomUUID()}`,
		workOrderId: sql`${workOrderId}`,
		[target]: sql`${id}`,
		createdAt: sql`(unixepoch())`
	};
	const row = sql.join(
		Object.keys(getTableColumns(workOrderLink)).map((key) => values[key] ?? sql`null`),
		sql`, `
	);
	return db
		.insert(workOrderLink)
		.select(
			sql`select ${row} where exists (select 1 from ${workOrder} where ${workOrder.id} = ${workOrderId})`
		);
}

/**
 * Replace the task's links of one kind with `id`, or remove them when null.
 * The two statements are returned for the caller's batch.
 */
export function replaceLink(workOrderId: string, target: LinkTarget, id: string | null) {
	const clear = db
		.delete(workOrderLink)
		.where(and(eq(workOrderLink.workOrderId, workOrderId), isNotNull(workOrderLink[target])));
	return id
		? ([clear, ...linkInserts(workOrderId, { [target]: id })] as const)
		: ([clear] as const);
}

/**
 * Tasks linked to this record: an indexed lookup on the target's partial index.
 * `id` may be an outer query's column, for a correlated lookup.
 */
export function linkedTo(target: LinkTarget, id: string | SQLWrapper): SQL {
	return inArray(
		workOrder.id,
		db
			.select({ id: workOrderLink.workOrderId })
			.from(workOrderLink)
			.where(eq(workOrderLink[target], id))
	);
}

/** Tasks linked to any record of this kind. */
export function linkedToAny(target: LinkTarget): SQL {
	return inArray(
		workOrder.id,
		db
			.select({ id: workOrderLink.workOrderId })
			.from(workOrderLink)
			.where(isNotNull(workOrderLink[target]))
	);
}

/**
 * The task's first linked record of one kind, as a column of a query over
 * `work_order`. Most tasks are about one unit, and the screens that name it show one.
 * The outer table is named in full: drizzle leaves a lone table's columns
 * unqualified, which inside this subquery would read the link's own `id`.
 */
export function linkedIdSql(target: 'assetId' | 'reservationId') {
	const column = target === 'assetId' ? sql.raw('"asset_id"') : sql.raw('"reservation_id"');
	return sql<string | null>`(
		select l.${column} from "work_order_link" l
		where l."work_order_id" = "work_order"."id" and l.${column} is not null
		order by l."created_at", l."id" limit 1
	)`;
}

/** Each task's first linked unit, for a page of tasks. */
export async function linkedAssetIds(workOrderIds: string[]): Promise<Map<string, string>> {
	if (workOrderIds.length === 0) return new Map();
	const rows = await db
		.select({ workOrderId: workOrderLink.workOrderId, assetId: workOrderLink.assetId })
		.from(workOrderLink)
		.where(and(inArray(workOrderLink.workOrderId, workOrderIds), isNotNull(workOrderLink.assetId)))
		.orderBy(workOrderLink.createdAt, workOrderLink.id);
	const out = new Map<string, string>();
	for (const r of rows) if (r.assetId && !out.has(r.workOrderId)) out.set(r.workOrderId, r.assetId);
	return out;
}

/** One task's first linked unit. */
export async function linkedAssetId(workOrderId: string): Promise<string | null> {
	return (await linkedAssetIds([workOrderId])).get(workOrderId) ?? null;
}
