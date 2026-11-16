import { db } from '#lib/server/db/index.js';
import {
	volunteerRole,
	workOrder,
	workOrderAssignee,
	workOrderDependency
} from '#lib/server/db/schema/volunteer.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { domainEvents } from '#lib/server/event-bus/event-bus.js';

/**
 * Task dependencies (#2625): a task waits on others. Blocked is derived on
 * read, from the open tasks it waits on. A cycle is an integrity failure, so it
 * is refused on write; everything else follows warn, record, allow. Imports
 * nothing from the work-order service, which reaches this lazily.
 */

export class TaskDependencyError extends DomainError {
	readonly httpStatus = 422;
}

/** A task as the other end of an edge: what to call it, and whether it is still to do. */
export interface LinkedTask {
	id: string;
	label: string;
	open: boolean;
}

const blocker = alias(workOrder, 'blocker');
const blockerRole = alias(volunteerRole, 'blocker_role');

/** The task's name where it has one, else its role's, as the work-order label falls back. */
function labelOf(t: { id: string; title: string | null; roleName?: string | null }): string {
	return t.title?.trim() || t.roleName || t.id;
}

async function taskLabel(
	id: string
): Promise<{ id: string; label: string; projectId: string | null } | null> {
	const [row] = await db
		.select({
			id: workOrder.id,
			title: workOrder.title,
			roleName: volunteerRole.name,
			projectId: workOrder.projectId
		})
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(eq(workOrder.id, id))
		.limit(1);
	return row ? { id: row.id, label: labelOf(row), projectId: row.projectId } : null;
}

/** Whether `from` already waits on `to`, directly or through other tasks. */
async function reaches(from: string, to: string): Promise<boolean> {
	const rows = await db.all<{ hit: number }>(sql`
		with recursive reach(id) as (
			select depends_on_id from work_order_dependency where work_order_id = ${from}
			union
			select d.depends_on_id from work_order_dependency d join reach r on d.work_order_id = r.id
		)
		select 1 as hit from reach where id = ${to} limit 1
	`);
	return rows.length > 0;
}

/**
 * Make `workOrderId` wait on `dependsOnId`. Refused when it would close a loop:
 * the new edge must not lead back to its start. Adding an edge that exists is
 * a no-op.
 */
export async function addDependency(input: {
	workOrderId: string;
	dependsOnId: string;
	byUserId: string;
}): Promise<void> {
	const { workOrderId, dependsOnId } = input;
	if (workOrderId === dependsOnId) {
		throw new TaskDependencyError('A task cannot wait on itself.');
	}
	const [task, other] = await Promise.all([taskLabel(workOrderId), taskLabel(dependsOnId)]);
	if (!task || !other) throw new TaskDependencyError('That task does not exist.');
	// Within one project, or among tasks in none: the guard on either end is then the same.
	if (task.projectId !== other.projectId) {
		throw new TaskDependencyError('Pick a task in the same project.');
	}
	if (await reaches(dependsOnId, workOrderId)) {
		throw new TaskDependencyError(
			`${other.label} already waits on ${task.label}, so ${task.label} cannot wait on it.`
		);
	}
	const added = await db
		.insert(workOrderDependency)
		.values({ workOrderId, dependsOnId, createdByUserId: input.byUserId })
		.onConflictDoNothing()
		.returning();
	if (added.length === 0) return;
	await recordAuditEntry({
		action: 'work_order.dependency_added',
		subject: { type: 'work_order', id: workOrderId, label: task.label },
		details: { dependsOnId, dependsOnLabel: other.label }
	});
}

/** Stop `workOrderId` waiting on `dependsOnId`. Removing an edge that is not there is a no-op. */
export async function removeDependency(input: {
	workOrderId: string;
	dependsOnId: string;
}): Promise<void> {
	const { workOrderId, dependsOnId } = input;
	const removed = await db
		.delete(workOrderDependency)
		.where(
			and(
				eq(workOrderDependency.workOrderId, workOrderId),
				eq(workOrderDependency.dependsOnId, dependsOnId)
			)
		)
		.returning();
	if (removed.length === 0) return;
	const [task, other] = await Promise.all([taskLabel(workOrderId), taskLabel(dependsOnId)]);
	await recordAuditEntry({
		action: 'work_order.dependency_removed',
		subject: { type: 'work_order', id: workOrderId, label: task?.label ?? workOrderId },
		details: { dependsOnId, dependsOnLabel: other?.label ?? dependsOnId }
	});
}

/** A task's two lists: what it waits on, and what waits on it. Open ones first. */
export async function listTaskDependencies(
	id: string
): Promise<{ waitsOn: LinkedTask[]; neededFor: LinkedTask[] }> {
	const linked = (column: 'depends_on_id' | 'work_order_id') => {
		const other =
			column === 'depends_on_id'
				? workOrderDependency.dependsOnId
				: workOrderDependency.workOrderId;
		const self =
			column === 'depends_on_id'
				? workOrderDependency.workOrderId
				: workOrderDependency.dependsOnId;
		return db
			.select({
				id: workOrder.id,
				title: workOrder.title,
				roleName: volunteerRole.name,
				resolvedAt: workOrder.resolvedAt,
				cancelledAt: workOrder.cancelledAt
			})
			.from(workOrderDependency)
			.innerJoin(workOrder, eq(workOrder.id, other))
			.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.where(eq(self, id))
			.orderBy(asc(workOrder.createdAt), asc(workOrder.id));
	};
	const shape = (rows: Awaited<ReturnType<typeof linked>>): LinkedTask[] =>
		rows
			.map((r) => ({ id: r.id, label: labelOf(r), open: !r.resolvedAt && !r.cancelledAt }))
			.sort((a, b) => Number(b.open) - Number(a.open));
	const [waitsOn, neededFor] = await Promise.all([
		linked('depends_on_id'),
		linked('work_order_id')
	]);
	return { waitsOn: shape(waitsOn), neededFor: shape(neededFor) };
}

/**
 * Open tasks the task in scope waits on: what makes it Blocked. A called-off
 * task blocks nothing, since it will never be done.
 */
export function openBlockersSql() {
	return sql<number>`(
		select count(*) from "work_order_dependency" d
		join "work_order" b on b."id" = d."depends_on_id"
		where d."work_order_id" = ${workOrder.id}
			and b."resolved_at" is null and b."cancelled_at" is null
	)`;
}

export async function countOpenBlockers(id: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(workOrderDependency)
		.innerJoin(blocker, eq(blocker.id, workOrderDependency.dependsOnId))
		.where(
			and(
				eq(workOrderDependency.workOrderId, id),
				isNull(blocker.resolvedAt),
				isNull(blocker.cancelledAt)
			)
		);
	return Number(row?.n ?? 0);
}

/**
 * Every open task's open blockers, by name: the Tasks table's "waits on" line.
 * Read whole rather than by task id, which would bind one parameter per row.
 */
export async function listOpenBlockers(): Promise<Record<string, { id: string; label: string }[]>> {
	const rows = await db
		.select({
			workOrderId: workOrderDependency.workOrderId,
			id: blocker.id,
			title: blocker.title,
			roleName: blockerRole.name
		})
		.from(workOrderDependency)
		.innerJoin(blocker, eq(blocker.id, workOrderDependency.dependsOnId))
		.innerJoin(workOrder, eq(workOrder.id, workOrderDependency.workOrderId))
		.leftJoin(blockerRole, eq(blockerRole.id, blocker.volunteerRoleId))
		.where(
			and(
				isNull(blocker.resolvedAt),
				isNull(blocker.cancelledAt),
				isNull(workOrder.resolvedAt),
				isNull(workOrder.cancelledAt)
			)
		)
		.orderBy(asc(blocker.createdAt), asc(blocker.id));
	const out: Record<string, { id: string; label: string }[]> = {};
	for (const r of rows) (out[r.workOrderId] ??= []).push({ id: r.id, label: labelOf(r) });
	return out;
}

/**
 * After `closedId` is done or called off: each open task that waited on it and
 * now waits on nothing open, with its assignees. Their "ready" notice.
 */
export async function announceTasksReady(closedId: string): Promise<void> {
	const closed = await taskLabel(closedId);
	const waiting = await db
		.select({ id: workOrder.id, title: workOrder.title, roleName: volunteerRole.name })
		.from(workOrderDependency)
		.innerJoin(workOrder, eq(workOrder.id, workOrderDependency.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(
			and(
				eq(workOrderDependency.dependsOnId, closedId),
				isNull(workOrder.resolvedAt),
				isNull(workOrder.cancelledAt)
			)
		);
	for (const task of waiting) {
		if ((await countOpenBlockers(task.id)) > 0) continue;
		const people = await db
			.select({ userId: user.id, userName: user.name, userEmail: user.email })
			.from(workOrderAssignee)
			.innerJoin(user, eq(user.id, workOrderAssignee.userId))
			.where(eq(workOrderAssignee.workOrderId, task.id));
		for (const recipient of people) {
			await domainEvents.emit('volunteer.task_ready', {
				workOrderId: task.id,
				title: labelOf(task),
				closedTitle: closed?.label ?? closedId,
				recipient
			});
		}
	}
}

/**
 * What a task could wait on: the open tasks in its own project, or in no
 * project when it is in none, less itself and what it already waits on.
 */
export async function listDependencyOptions(id: string): Promise<{ id: string; label: string }[]> {
	const self = await taskLabel(id);
	if (!self) return [];
	const rows = await db
		.select({ id: workOrder.id, title: workOrder.title, roleName: volunteerRole.name })
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(
			and(
				self.projectId ? eq(workOrder.projectId, self.projectId) : isNull(workOrder.projectId),
				isNull(workOrder.resolvedAt),
				isNull(workOrder.cancelledAt),
				sql`${workOrder.id} <> ${id}`,
				sql`not exists (
					select 1 from "work_order_dependency" d
					where d."work_order_id" = ${id} and d."depends_on_id" = ${workOrder.id}
				)`
			)
		)
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id));
	return rows.map((r) => ({ id: r.id, label: labelOf(r) }));
}

/**
 * A project's tasks and the edges between them, for its graph (#2625). Called-off
 * tasks are left out, since they block nothing; done ones stay, greyed.
 */
export async function listProjectGraph(projectId: string): Promise<{
	nodes: { id: string; label: string; done: boolean }[];
	edges: { taskId: string; dependsOnId: string }[];
}> {
	const [tasks, edges] = await Promise.all([
		db
			.select({
				id: workOrder.id,
				title: workOrder.title,
				roleName: volunteerRole.name,
				resolvedAt: workOrder.resolvedAt
			})
			.from(workOrder)
			.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.where(and(eq(workOrder.projectId, projectId), isNull(workOrder.cancelledAt))),
		db
			.select({
				taskId: workOrderDependency.workOrderId,
				dependsOnId: workOrderDependency.dependsOnId
			})
			.from(workOrderDependency)
			.innerJoin(workOrder, eq(workOrder.id, workOrderDependency.workOrderId))
			.where(eq(workOrder.projectId, projectId))
	]);
	return {
		nodes: tasks.map((t) => ({ id: t.id, label: labelOf(t), done: t.resolvedAt !== null })),
		edges
	};
}
