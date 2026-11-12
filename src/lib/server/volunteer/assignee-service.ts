import { and, asc, eq, gte, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { volunteerRole, workOrder, workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { DomainError } from '#lib/server/errors.js';
import { VOLUNTEER_BACKDATE_LIMIT_DAYS } from '#lib/config.js';
import {
	requireActiveVolunteer,
	VolunteerProfileBlockedError,
	VolunteerProfileNotFoundError
} from './volunteer-profile-service';
import { missingRequirements } from './member-certification-service';
import { VolunteerUnderReviewError } from './volunteer-signup-service';
import { resolveWorkOrder, ShiftValidationError, workOrderAuditLabel } from './work-order-service';

// ---------------------------------------------------------------------------
// Assignment (#2518): staff or a committee name who is doing a task. Not a
// sign-up — no places, reminder, feedback or clock. Warn, record, allow
// (conventions.md#workflow-gates): no volunteer profile and a missing clearance
// are recorded warnings; a profile under review refuses.
// ---------------------------------------------------------------------------

const NO_PROFILE_WARNING = 'No volunteer profile on file: never signed up to volunteer.';

type TaskRef = { id: string; title: string | null; volunteerRoleId: string | null };

async function memberName(userId: string): Promise<string> {
	const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
	return row?.name ?? 'Unknown member';
}

/**
 * Put somebody on a task. Returns the warnings staff went over; already being
 * on it is a no-op with none. Clearances are checked as of today: a task has
 * no time of its own.
 */
export async function assignToTask(
	task: TaskRef,
	userId: string,
	assignedByUserId: string | null
): Promise<{ warnings: string[]; added: boolean }> {
	const warnings: string[] = [];
	try {
		await requireActiveVolunteer(userId);
	} catch (err) {
		// Putting an unreviewed minor on work is the integrity case: refused.
		if (err instanceof VolunteerProfileBlockedError) throw new VolunteerUnderReviewError();
		if (!(err instanceof VolunteerProfileNotFoundError)) throw err;
		warnings.push(NO_PROFILE_WARNING);
	}
	if (task.volunteerRoleId) {
		const missing = await missingRequirements(userId, task.volunteerRoleId, new Date());
		if (missing.length > 0) {
			warnings.push(`Not cleared: no ${missing.map((m) => m.name).join(' and ')} as of today.`);
		}
	}

	const added = await db
		.insert(workOrderAssignee)
		.values({ workOrderId: task.id, userId, assignedByUserId, assignedAt: new Date() })
		.onConflictDoNothing()
		.returning({ userId: workOrderAssignee.userId });
	if (added.length === 0) return { warnings: [], added: false };

	const subject = { type: 'work_order' as const, id: task.id, label: workOrderAuditLabel(task) };
	const name = await memberName(userId);
	await recordAuditEntry({
		action: 'work_order.member_assigned',
		subject,
		details: { userId, memberName: name }
	});
	if (warnings.length > 0) {
		await recordAuditEntry({
			action: 'work_order.assigned_over_warnings',
			subject,
			details: { userId, memberName: name, warnings }
		});
	}
	return { warnings, added: true };
}

/** Take somebody off a task. False when they were not on it. */
export async function unassignFromTask(
	task: Pick<TaskRef, 'id' | 'title'>,
	userId: string
): Promise<boolean> {
	const removed = await db
		.delete(workOrderAssignee)
		.where(and(eq(workOrderAssignee.workOrderId, task.id), eq(workOrderAssignee.userId, userId)))
		.returning({ userId: workOrderAssignee.userId });
	if (removed.length === 0) return false;
	await recordAuditEntry({
		action: 'work_order.member_unassigned',
		subject: { type: 'work_order', id: task.id, label: workOrderAuditLabel(task) },
		details: { userId, memberName: await memberName(userId) }
	});
	return true;
}

/** Everybody assigned the task, as a statement for the caller's batch. */
export function removeAllAssignees(workOrderId: string) {
	return db.delete(workOrderAssignee).where(eq(workOrderAssignee.workOrderId, workOrderId));
}

// ---------------------------------------------------------------------------
// The assignee's own list (#2518): the tasks staff or a committee gave them,
// and the done ones whose hours they have not logged.
// ---------------------------------------------------------------------------

export class NotAssignedToTaskError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('That task is not assigned to you');
	}
}

export interface AssignedTask {
	workOrderId: string;
	title: string | null;
	eventTitle: string | null;
	volunteerRoleId: string | null;
	roleName: string | null;
	dueAt: Date | null;
	/** The task has a done condition: the app closes it, not the assignee. */
	closesItself: boolean;
	resolvedAt: Date | null;
	/** When the task was marked done, which is what prompts the hours. */
	completedAt: Date | null;
	checklist: { done: number; total: number };
}

/**
 * Open tasks assigned to `userId`, then done ones with no hour log naming the
 * task, inside the backdate window `submitHours` accepts.
 */
export async function listAssignedTasksForUser(userId: string): Promise<AssignedTask[]> {
	const earliest = new Date(Date.now() - VOLUNTEER_BACKDATE_LIMIT_DAYS * 86_400_000);
	const rows = await db
		.select({
			workOrderId: workOrder.id,
			title: workOrder.title,
			eventTitle: eventListing.title,
			volunteerRoleId: workOrder.volunteerRoleId,
			roleName: volunteerRole.name,
			dueAt: workOrder.dueAt,
			doneWhen: workOrder.doneWhen,
			resolvedAt: workOrder.resolvedAt,
			completedAt: workOrderAssignee.completedAt,
			checklistTotal: sql<number>`(
				select count(*) from "work_task" wt where wt."work_order_id" = ${workOrder.id}
			)`,
			checklistDone: sql<number>`(
				select count(*) from "work_task" wt
				where wt."work_order_id" = ${workOrder.id} and wt."done" = 1
			)`
		})
		.from(workOrderAssignee)
		.innerJoin(workOrder, eq(workOrder.id, workOrderAssignee.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(
			and(
				eq(workOrderAssignee.userId, userId),
				isNull(workOrder.cancelledAt),
				or(
					isNull(workOrder.resolvedAt),
					and(
						isNotNull(workOrderAssignee.completedAt),
						gte(workOrderAssignee.completedAt, earliest),
						sql`not exists (
							select 1 from "volunteer_hour_log" vhl
							where vhl."work_order_id" = ${workOrder.id} and vhl."user_id" = ${userId}
						)`
					)
				)
			)
		)
		.orderBy(
			sql`${workOrder.dueAt} is null`,
			asc(workOrder.dueAt),
			asc(workOrderAssignee.assignedAt)
		);

	return rows.map(({ doneWhen, checklistTotal, checklistDone, ...row }) => ({
		...row,
		closesItself: doneWhen !== null,
		checklist: { done: Number(checklistDone), total: Number(checklistTotal) }
	}));
}

/**
 * Mark a task done as one of its assignees. A task with a done condition is
 * the app's to close; overriding that takes a reason, which is staff's call.
 */
export async function markAssignedTaskDone(workOrderId: string, userId: string): Promise<void> {
	const [row] = await db
		.select({ doneWhen: workOrder.doneWhen })
		.from(workOrderAssignee)
		.innerJoin(workOrder, eq(workOrder.id, workOrderAssignee.workOrderId))
		.where(
			and(eq(workOrderAssignee.workOrderId, workOrderId), eq(workOrderAssignee.userId, userId))
		)
		.limit(1);
	if (!row) throw new NotAssignedToTaskError();
	if (row.doneWhen !== null) {
		throw new ShiftValidationError('This task closes itself when its condition holds.');
	}
	await resolveWorkOrder(workOrderId, { resolvedByUserId: userId });
}
