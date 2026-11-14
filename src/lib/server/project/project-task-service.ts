import { type LinkTo } from '#lib/server/task/work-order-link.js';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { fundingProjectKinds } from '#lib/config.js';
import { project, projectCommittee } from '#lib/server/db/schema/project.js';
import { workOrder, type Task } from '#lib/server/db/schema/volunteer.js';
import { DomainError } from '#lib/server/domain-error.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { evaluateDone, type DeliverableState } from '#lib/server/volunteer/done-conditions.js';
import {
	auditWorkOrderChange,
	cancelShift,
	createWorkOrder
} from '#lib/server/volunteer/work-order-service.js';
import { nextTaskOrders, requireSection } from '#lib/server/project/project-section-service.js';

// ---------------------------------------------------------------------------
// A project's task list: the work orders on it, as a checklist. Every function
// takes the project id and refuses a work order that is not on that project,
// because a remote takes both ids from the client.
// ---------------------------------------------------------------------------

export class TaskNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Task not found');
	}
}

export class TaskValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export class TaskConflictError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
	}
}

/** The work order, refused (404) unless it belongs to this project. */
export async function requireTaskInProject(projectId: string, workOrderId: string): Promise<Task> {
	const [row] = await db
		.select()
		.from(workOrder)
		.where(and(eq(workOrder.id, workOrderId), eq(workOrder.projectId, projectId)))
		.limit(1);
	if (!row) throw new TaskNotFoundError();
	return row;
}

async function requireLiveTask(projectId: string, workOrderId: string): Promise<Task> {
	const task = await requireTaskInProject(projectId, workOrderId);
	if (task.cancelledAt) throw new TaskConflictError('That task was called off.');
	return task;
}

const label = (task: Pick<Task, 'id' | 'title'>) => task.title ?? task.id;

// ---------------------------------------------------------------------------
// Create, order, move
// ---------------------------------------------------------------------------

/** A line typed into the list: a title, at the end of its section, nothing else set. */
export async function createTask(data: {
	projectId: string;
	title: string;
	sectionId?: string | null;
	createdByUserId: string;
	/** The record it was created from, when that is not only the project (#2630). */
	eventId?: string | null;
	groupId?: string | null;
	volunteerRoleId?: string | null;
	/** What it is about (`work_order_link`). */
	links?: LinkTo;
}): Promise<Task> {
	const sectionId = data.sectionId || null;
	if (sectionId) await requireSection(data.projectId, sectionId);
	if (!data.title.trim()) throw new TaskValidationError('Give the task a title.');
	const [order, fundingOwner] = await Promise.all([
		nextTaskOrders(data.projectId).then((o) => o.get(sectionId) ?? 0),
		fundingOwnerOf(data.projectId)
	]);
	const row = await createWorkOrder({
		title: data.title,
		projectId: data.projectId,
		sectionId,
		sortOrder: order,
		createdByUserId: data.createdByUserId,
		eventId: data.eventId,
		// A committee named here wins; a grant's or sponsorship's task falls back to its owner.
		groupId: data.groupId || fundingOwner,
		volunteerRoleId: data.volunteerRoleId,
		links: data.links
	});
	await recordAuditEntry({
		action: 'work_order.created',
		subject: { type: 'work_order', id: row.id, label: label(row) },
		details: { projectId: data.projectId, title: row.title ?? '' }
	});
	return row;
}

/**
 * A grant's or sponsorship's owning committee, so a task added to one carries
 * it and the committee's reminders reach it unassigned (#2622). Null elsewhere.
 */
async function fundingOwnerOf(projectId: string): Promise<string | null> {
	const [row] = await db
		.select({ groupId: projectCommittee.groupId })
		.from(projectCommittee)
		.innerJoin(project, eq(project.id, projectCommittee.projectId))
		.where(
			and(
				eq(projectCommittee.projectId, projectId),
				eq(projectCommittee.role, 'owner'),
				inArray(project.kind, [...fundingProjectKinds])
			)
		)
		.limit(1);
	return row?.groupId ?? null;
}

function sectionIs(sectionId: string | null) {
	return sectionId ? eq(workOrder.sectionId, sectionId) : isNull(workOrder.sectionId);
}

async function tasksIn(projectId: string, sectionId: string | null, except?: string) {
	return db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.projectId, projectId),
				sectionIs(sectionId),
				except ? ne(workOrder.id, except) : undefined
			)
		)
		.orderBy(asc(workOrder.sortOrder), asc(workOrder.createdAt), asc(workOrder.id));
}

/** Write `ids` as positions 0..n in `sectionId`, in one batch. */
async function writeOrder(ids: string[], sectionId: string | null) {
	if (ids.length === 0) return;
	const now = new Date();
	await db.batch(
		ids.map((id, i) =>
			db
				.update(workOrder)
				.set({ sectionId, sortOrder: i, updatedAt: now })
				.where(eq(workOrder.id, id))
		) as unknown as Parameters<typeof db.batch>[0]
	);
}

/**
 * Put a task at `index` in a section (null: the unlabelled group), renumbering
 * that section so positions stay 0..n. The section it left keeps its gaps,
 * which order the same.
 */
export async function moveTask(
	projectId: string,
	workOrderId: string,
	to: { sectionId: string | null; index: number }
): Promise<void> {
	const task = await requireTaskInProject(projectId, workOrderId);
	if (to.sectionId) await requireSection(projectId, to.sectionId);
	const ids = (await tasksIn(projectId, to.sectionId, workOrderId)).map((r) => r.id);
	const at = Math.max(0, Math.min(Math.trunc(to.index), ids.length));
	ids.splice(at, 0, workOrderId);
	await writeOrder(ids, to.sectionId);

	if (task.sectionId !== to.sectionId) {
		await recordAuditEntry({
			action: 'work_order.moved',
			subject: { type: 'work_order', id: task.id, label: label(task) },
			details: { fromSectionId: task.sectionId, toSectionId: to.sectionId }
		});
	}
}

// ---------------------------------------------------------------------------
// Rescheduled, called off
// ---------------------------------------------------------------------------

/**
 * Move the task's deadline; blank clears it. A shift's time is the shift's own,
 * edited on the task page or opened from the assign picker (#2518).
 */
export async function rescheduleTask(
	projectId: string,
	workOrderId: string,
	data: { dueAt: Date | null }
): Promise<Task> {
	const task = await requireLiveTask(projectId, workOrderId);
	const [row] = await db
		.update(workOrder)
		.set({ dueAt: data.dueAt, updatedAt: new Date() })
		.where(eq(workOrder.id, task.id))
		.returning();
	await auditWorkOrderChange(task, row);
	return row;
}

/** Call it off. Its signups stay, as a notify list, exactly as a cancelled shift's do. */
export async function cancelTask(
	projectId: string,
	workOrderId: string,
	cancelledByUserId: string
): Promise<Task> {
	const task = await requireLiveTask(projectId, workOrderId);
	return cancelShift(task.id, cancelledByUserId);
}

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

export interface Progress {
	done: number;
	total: number;
}

/** Done over live: every mode counts, cancelled ones do not, and done is `evaluateDone`'s. */
function progressOf(states: Map<string, DeliverableState>): Progress {
	let done = 0;
	let total = 0;
	for (const s of states.values()) {
		if (s === 'cancelled') continue;
		total += 1;
		if (s === 'done') done += 1;
	}
	return { done, total };
}

const doneInputColumns = {
	id: workOrder.id,
	eventId: workOrder.eventId,
	doneWhen: workOrder.doneWhen,
	resolvedAt: workOrder.resolvedAt,
	cancelledAt: workOrder.cancelledAt,
	dueAt: workOrder.dueAt
};

export async function getProjectProgress(projectId: string): Promise<Progress> {
	const rows = await db
		.select(doneInputColumns)
		.from(workOrder)
		.where(and(eq(workOrder.projectId, projectId), isNull(workOrder.cancelledAt)));
	return progressOf(await evaluateDone(rows));
}

/** `getProjectProgress` for many projects in one query, keyed by project id. */
export async function listProjectProgress(projectIds: string[]): Promise<Map<string, Progress>> {
	const out = new Map<string, Progress>(projectIds.map((id) => [id, { done: 0, total: 0 }]));
	if (projectIds.length === 0) return out;
	const rows = await db
		.select({ ...doneInputColumns, projectId: workOrder.projectId })
		.from(workOrder)
		.where(and(inArray(workOrder.projectId, projectIds), isNull(workOrder.cancelledAt)));
	const states = await evaluateDone(rows);
	for (const r of rows) {
		const p = out.get(r.projectId!);
		const s = states.get(r.id);
		if (!p || s === 'cancelled') continue;
		p.total += 1;
		if (s === 'done') p.done += 1;
	}
	return out;
}
