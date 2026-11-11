import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import {
	requireActiveVolunteer,
	VolunteerProfileBlockedError,
	VolunteerProfileNotFoundError
} from './volunteer-profile-service';
import { missingRequirements } from './member-certification-service';
import { VolunteerUnderReviewError } from './volunteer-signup-service';
import { workOrderAuditLabel } from './work-order-service';

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
