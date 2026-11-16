import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { groupPosition } from '#lib/server/db/schema/group.js';
import { workOrder } from '#lib/server/db/schema/volunteer.js';
import { DomainError } from '#lib/server/domain-error.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';

/**
 * A task tagged for a department position waits on that position's holders
 * (#2990). The position is always one of the task's own committee's, so a
 * holder's `position` reason never reaches outside their department.
 */

export class TaskPositionError extends DomainError {
	constructor(
		message: string,
		readonly httpStatus: 400 | 404
	) {
		super(message);
	}
}

async function taskRow(workOrderId: string) {
	const [row] = await db
		.select({
			id: workOrder.id,
			title: workOrder.title,
			groupId: workOrder.groupId,
			positionId: workOrder.positionId
		})
		.from(workOrder)
		.where(eq(workOrder.id, workOrderId))
		.limit(1);
	if (!row) throw new TaskPositionError('Task not found.', 404);
	return row;
}

/** The task's position and the ones it may be tagged for: its committee's, the chair first. */
export async function taskPositionChoices(workOrderId: string) {
	const row = await taskRow(workOrderId);
	const options = row.groupId
		? await db
				.select({ id: groupPosition.id, name: groupPosition.name })
				.from(groupPosition)
				.where(eq(groupPosition.groupId, row.groupId))
				.orderBy(desc(groupPosition.isChair), asc(groupPosition.name))
		: [];
	return { positionId: row.positionId, options };
}

/** Tag the task for a position of its committee, or clear the tag with null. */
export async function setTaskPosition(workOrderId: string, positionId: string | null) {
	const row = await taskRow(workOrderId);
	if (row.positionId === positionId) return;
	if (positionId) {
		if (!row.groupId) {
			throw new TaskPositionError('Give the task a committee before a position.', 400);
		}
		const [position] = await db
			.select({ id: groupPosition.id })
			.from(groupPosition)
			.where(and(eq(groupPosition.id, positionId), eq(groupPosition.groupId, row.groupId)))
			.limit(1);
		if (!position) {
			throw new TaskPositionError("Pick one of the task's committee's positions.", 400);
		}
	}
	await db
		.update(workOrder)
		.set({ positionId, updatedAt: new Date() })
		.where(eq(workOrder.id, workOrderId));
	await recordAuditEntry({
		action: 'work_order.edited',
		subject: { type: 'work_order', id: row.id, label: row.title ?? row.id },
		details: { fields: ['position'] }
	});
}
