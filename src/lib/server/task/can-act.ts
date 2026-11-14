import { error } from '@sveltejs/kit';
import { and, eq, exists, inArray, isNull, notExists, or, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { workOrder, workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';
import { requireUser, userHasCapability } from '#lib/server/authorization.js';

/**
 * Why a person may act on a task: take it, tick its checklist, mark it done,
 * hand it back. A duty grants that and nothing on the linked record or show
 * (#2983 rule 2). Editing, assigning others and calling it off need the grant.
 */
export type TaskActReason = 'assignee' | 'department' | 'grant';

/** The grant that covers any task, scoped by the row's committee and project. */
export const TASK_GRANT = 'volunteer.manageShifts' as const;

/** The live committees the user holds an active seat on. */
export function seatsOf(userId: string) {
	return db
		.select({ id: groupMember.groupId })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(
			and(
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt)
			)
		);
}

/** The user is on the task's `work_order_assignee` rows; `open` drops ones they finished. */
export function assignedTo(userId: string, opts: { open?: boolean } = {}): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(workOrderAssignee)
			.where(
				and(
					eq(workOrderAssignee.workOrderId, workOrder.id),
					eq(workOrderAssignee.userId, userId),
					opts.open ? isNull(workOrderAssignee.completedAt) : undefined
				)
			)
	);
}

/** The task belongs to a committee the user sits on. */
export function inDepartmentOf(userId: string): SQL {
	return inArray(workOrder.groupId, seatsOf(userId));
}

const anyAssignee = () =>
	db
		.select({ one: sql`1` })
		.from(workOrderAssignee)
		.where(eq(workOrderAssignee.workOrderId, workOrder.id));

/**
 * The open tasks waiting on this user, for "Your tasks" on both dashboards:
 * assigned to them and not yet done by them, or in a committee they sit on
 * with nobody assigned. A subset of what `canActOnTask` admits, so a list
 * never offers a task its remotes refuse.
 */
export function waitingOn(userId: string): SQL {
	return and(
		isNull(workOrder.resolvedAt),
		isNull(workOrder.cancelledAt),
		or(assignedTo(userId, { open: true }), and(inDepartmentOf(userId), notExists(anyAssignee())))
	)!;
}

/**
 * The one rule (#2989): whether `userId` may act on the task, and why. A
 * missing task is null, so a guard answers it as it answers someone else's.
 */
export async function canActOnTask(
	userId: string,
	workOrderId: string
): Promise<TaskActReason | null> {
	const [row] = await db
		.select({
			groupId: workOrder.groupId,
			projectId: workOrder.projectId,
			assignee: sql<number>`${assignedTo(userId)}`,
			department: sql<number>`${inDepartmentOf(userId)}`
		})
		.from(workOrder)
		.where(eq(workOrder.id, workOrderId))
		.limit(1);
	if (!row) return null;
	if (Number(row.assignee)) return 'assignee';
	if (Number(row.department)) return 'department';
	const scope = { groupId: row.groupId, projectId: row.projectId };
	return (await userHasCapability(userId, TASK_GRANT, scope)) ? 'grant' : null;
}

/** The guard for a duty write: the caller and their reason, else 403. */
export async function requireActOnTask(workOrderId: string) {
	const user = requireUser();
	const reason = await canActOnTask(user.id, workOrderId);
	if (!reason) error(403, 'That task is not yours to act on');
	return { user, reason };
}
