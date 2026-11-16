import { error } from '@sveltejs/kit';
import { and, eq, exists, inArray, isNull, not, notExists, or, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { workOrder, workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '#lib/server/db/schema/group.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { requireUser, userHasCapability } from '#lib/server/authorization.js';

/**
 * Why a person may act on a task: take it, tick its checklist, mark it done,
 * hand it back. A duty grants that and nothing on the linked record or show
 * (#2983 rule 2). Editing, assigning others and calling it off need the grant.
 */
export type TaskActReason = 'assignee' | 'position' | 'department' | 'grant';

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

/**
 * The task is tagged for a position the user holds through an active seat on
 * a live committee (#2990). The position must be the task's own committee's,
 * so a tag that outlived a reassignment admits nobody.
 */
export function heldBy(userId: string): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(groupPositionHolder)
			.innerJoin(groupPosition, eq(groupPosition.id, groupPositionHolder.positionId))
			.innerJoin(groupMember, eq(groupMember.id, groupPositionHolder.memberId))
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.where(
				and(
					eq(groupPosition.id, workOrder.positionId),
					eq(groupPosition.groupId, workOrder.groupId),
					eq(groupMember.userId, userId),
					eq(groupMember.status, 'active'),
					eq(group.kind, 'committee'),
					isNull(group.deletedAt)
				)
			)
	);
}

/** The task's position has an active holder, so it waits on them, not the department. */
const positionFilled = () =>
	exists(
		db
			.select({ one: sql`1` })
			.from(groupPositionHolder)
			.innerJoin(groupPosition, eq(groupPosition.id, groupPositionHolder.positionId))
			.innerJoin(groupMember, eq(groupMember.id, groupPositionHolder.memberId))
			.where(
				and(
					eq(groupPosition.id, workOrder.positionId),
					eq(groupPosition.groupId, workOrder.groupId),
					eq(groupMember.status, 'active')
				)
			)
	);

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
 * assigned to them and not yet done by them; else, with nobody assigned,
 * tagged for a position they hold, or in a committee they sit on whose
 * position (if any) is vacant. A subset of what `canActOnTask` admits, so a
 * list never offers a task its remotes refuse.
 */
export function waitingOn(userId: string): SQL {
	return and(
		isNull(workOrder.resolvedAt),
		isNull(workOrder.cancelledAt),
		or(
			assignedTo(userId, { open: true }),
			and(
				notExists(anyAssignee()),
				or(heldBy(userId), and(inDepartmentOf(userId), not(positionFilled())))
			)
		)
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
			position: sql<number>`${heldBy(userId)}`,
			department: sql<number>`${inDepartmentOf(userId)}`
		})
		.from(workOrder)
		.where(eq(workOrder.id, workOrderId))
		.limit(1);
	if (!row) return null;
	if (Number(row.assignee)) return 'assignee';
	if (Number(row.position)) return 'position';
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

/** Why the task waits on someone: the reasons `waitingOn` admits. */
export type WaitReason = Exclude<TaskActReason, 'grant'>;

export interface TaskWaiter {
	userId: string;
	name: string;
	reason: WaitReason;
}

/**
 * Who the task waits on and why (#2994): `waitingOn` asked of everyone it could
 * admit (the assignees, the position's holders, the committee's active seats)
 * in one read, so this list and "Your tasks" cannot disagree.
 */
export async function waitsOnTask(workOrderId: string): Promise<TaskWaiter[]> {
	const [assignees, members, holders] = await Promise.all([
		db
			.select({ userId: workOrderAssignee.userId })
			.from(workOrderAssignee)
			.where(eq(workOrderAssignee.workOrderId, workOrderId)),
		db
			.select({ userId: groupMember.userId })
			.from(groupMember)
			.innerJoin(workOrder, eq(workOrder.groupId, groupMember.groupId))
			.where(and(eq(workOrder.id, workOrderId), eq(groupMember.status, 'active'))),
		db
			.select({ userId: groupMember.userId })
			.from(groupPositionHolder)
			.innerJoin(groupMember, eq(groupMember.id, groupPositionHolder.memberId))
			.innerJoin(workOrder, eq(workOrder.positionId, groupPositionHolder.positionId))
			.where(eq(workOrder.id, workOrderId))
	]);
	const candidates = [...new Set([...assignees, ...members, ...holders].map((r) => r.userId))];
	if (candidates.length === 0) return [];

	const columns: Record<string, SQL<number>> = {};
	candidates.forEach((uid, i) => {
		columns[`w${i}`] = sql<number>`${waitingOn(uid)}`;
		columns[`a${i}`] = sql<number>`${assignedTo(uid, { open: true })}`;
		columns[`p${i}`] = sql<number>`${heldBy(uid)}`;
	});
	const [row] = await db.select(columns).from(workOrder).where(eq(workOrder.id, workOrderId));
	if (!row) return [];
	const waiting = candidates.flatMap((userId, i) => {
		if (!Number(row[`w${i}`])) return [];
		const reason: WaitReason = Number(row[`a${i}`])
			? 'assignee'
			: Number(row[`p${i}`])
				? 'position'
				: 'department';
		return [{ userId, reason }];
	});
	if (waiting.length === 0) return [];
	const names = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(
			inArray(
				user.id,
				waiting.map((w) => w.userId)
			)
		);
	const nameOf = new Map(names.map((n) => [n.id, n.name]));
	return waiting
		.map((w) => ({ ...w, name: nameOf.get(w.userId) ?? '' }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export interface TaskActExplanation {
	/** `canActOnTask`'s answer; null means every route below failed. */
	reason: TaskActReason | null;
	/** The committee whose seats may act, when the task has one. */
	committee: { id: string; name: string } | null;
	/** The position the task is tagged for, when it has one. */
	position: { id: string; name: string } | null;
	/** The grant that covers any task. */
	grant: typeof TASK_GRANT;
}

/**
 * Why `userId` can or cannot act on the task: `canActOnTask`'s reason with the
 * task's committee and position named. Null for a missing task.
 */
export async function explainTaskAct(
	userId: string,
	workOrderId: string
): Promise<TaskActExplanation | null> {
	const [[ctx], reason] = await Promise.all([
		db
			.select({
				committeeId: group.id,
				committeeName: group.name,
				committeeKind: group.kind,
				positionId: groupPosition.id,
				positionName: groupPosition.name
			})
			.from(workOrder)
			.leftJoin(group, eq(group.id, workOrder.groupId))
			.leftJoin(
				groupPosition,
				and(
					eq(groupPosition.id, workOrder.positionId),
					eq(groupPosition.groupId, workOrder.groupId)
				)
			)
			.where(eq(workOrder.id, workOrderId))
			.limit(1),
		canActOnTask(userId, workOrderId)
	]);
	if (!ctx) return null;
	const committee =
		ctx.committeeId && ctx.committeeName && ctx.committeeKind === 'committee'
			? { id: ctx.committeeId, name: ctx.committeeName }
			: null;
	const position =
		ctx.positionId && ctx.positionName ? { id: ctx.positionId, name: ctx.positionName } : null;
	return { reason, committee, position, grant: TASK_GRANT };
}
