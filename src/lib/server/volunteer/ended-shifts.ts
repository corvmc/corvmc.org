import { asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { volunteerRole, workOrder } from '#lib/server/db/schema/volunteer.js';
import { inventoryAsset, inventoryItem } from '#lib/server/db/schema/inventory.js';
import { evaluateDone } from './done-conditions';
import { tasksWithEndedShiftsWhere } from './work-order-service';

export interface TaskWithEndedShifts {
	id: string;
	title: string | null;
	roleName: string | null;
	/** When its last live shift ended. */
	endsAt: Date;
	unitName: string | null;
	assetTag: string | null;
	/** Equipment reports still open on it, which marking it done resolves. */
	reports: number;
}

/**
 * Open tasks whose last shift has ended, oldest first: Today's "mark done or
 * open another shift" list. A task whose `done_when` holds is already done and
 * is left out. `countVolunteerWorkWaiting` counts this list, so the badge and
 * the list cannot disagree (#1828).
 */
export async function listTasksWithEndedShifts(now = new Date()): Promise<TaskWithEndedShifts[]> {
	const endedAt = sql<number>`(
		select max(s."ends_at") from "volunteer_shift" s
		where s."work_order_id" = ${workOrder.id} and s."cancelled_at" is null
	)`;
	const rows = await db
		.select({
			id: workOrder.id,
			title: workOrder.title,
			roleName: volunteerRole.name,
			endedAt,
			unitName: inventoryItem.name,
			assetTag: inventoryAsset.assetTag,
			reports: sql<number>`(
				select count(*) from "work_request" wr
				where wr."work_order_id" = ${workOrder.id} and wr."status" = 'pending'
			)`,
			eventId: workOrder.eventId,
			doneWhen: workOrder.doneWhen,
			dueAt: workOrder.dueAt
		})
		.from(workOrder)
		// Left: a contractor's repair has no role.
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(inventoryAsset, eq(inventoryAsset.id, workOrder.assetId))
		.leftJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.where(tasksWithEndedShiftsWhere(now))
		.orderBy(asc(endedAt), asc(workOrder.id));

	const conditional = rows.filter((r) => r.doneWhen !== null);
	const state = conditional.length
		? await evaluateDone(
				conditional.map((r) => ({ ...r, resolvedAt: null, cancelledAt: null })),
				now
			)
		: new Map();

	return rows
		.filter((r) => state.get(r.id) !== 'done')
		.map((r) => ({
			id: r.id,
			title: r.title,
			roleName: r.roleName,
			endsAt: new Date(Number(r.endedAt) * 1000),
			unitName: r.unitName,
			assetTag: r.assetTag,
			reports: Number(r.reports)
		}));
}
