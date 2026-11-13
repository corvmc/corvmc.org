import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { volunteerRole, workOrder } from '#lib/server/db/schema/volunteer.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import {
	listShifts,
	type ScheduledShiftWithCounts
} from '#lib/server/volunteer/work-order-service.js';
import {
	listTasksWithEndedShifts,
	type TaskWithEndedShifts
} from '#lib/server/volunteer/ended-shifts.js';
import { relatedTaskWhere, relationsFor, type RelatedSubject } from './related-tasks';
import type { RelationKey } from '#lib/utils/related-tasks.js';

/**
 * A record's volunteer shifts (#2630): the shifts of its related tasks, under
 * the same relations as `relatedTasks`, so no record has a second resolver.
 * Cancelled shifts and shifts on called-off tasks are left out.
 */

export interface RelatedShiftGroup {
	key: RelationKey;
	shifts: ScheduledShiftWithCounts[];
	/** More matched than the limit let through. */
	more: boolean;
}

export interface RelatedShiftOptions {
	/** Shifts that end after this; defaults to now, so ended shifts are left out. */
	from?: Date;
	limitPerRelation?: number;
}

export async function relatedShifts(
	subject: RelatedSubject,
	{ from = new Date(), limitPerRelation = 30 }: RelatedShiftOptions = {}
): Promise<RelatedShiftGroup[]> {
	const relations = relationsFor(subject);
	const results = await Promise.all(
		relations.map((r) =>
			listShifts({ where: r.where, endsAfter: from, limit: limitPerRelation + 1 })
		)
	);
	const seen = new Set<string>();
	const groups: RelatedShiftGroup[] = [];
	relations.forEach((r, i) => {
		const rows = results[i];
		const shifts = rows.slice(0, limitPerRelation).filter((s) => !seen.has(s.shiftId!));
		for (const s of shifts) seen.add(s.shiftId!);
		if (shifts.length > 0)
			groups.push({ key: r.key, shifts, more: rows.length > limitPerRelation });
	});
	return groups;
}

/** The record's open tasks whose shifts have all ended: the Ended shifts chip. */
export async function relatedEndedShifts(
	subject: RelatedSubject,
	now = new Date()
): Promise<TaskWithEndedShifts[]> {
	const where = relatedTaskWhere(subject);
	return where ? listTasksWithEndedShifts(now, where) : [];
}

/** The record's open tasks a shift can be opened on: those with a volunteer role. */
export async function relatedShiftTasks(subject: RelatedSubject) {
	const where = relatedTaskWhere(subject);
	if (!where) return [];
	return db
		.select({
			id: workOrder.id,
			title: workOrder.title,
			roleName: volunteerRole.name,
			eventTitle: eventListing.title,
			defaultCapacity: volunteerRole.defaultCapacity,
			defaultDurationMinutes: volunteerRole.defaultDurationMinutes
		})
		.from(workOrder)
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(and(where, isNull(workOrder.resolvedAt), isNull(workOrder.cancelledAt)))
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id))
		.limit(100);
}

/** Whether a task is one of the record's: Add shift may only open a shift on those. */
export async function isRelatedTask(subject: RelatedSubject, taskId: string): Promise<boolean> {
	const where = relatedTaskWhere(subject);
	if (!where) return false;
	const [row] = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(and(where, eq(workOrder.id, taskId)))
		.limit(1);
	return row !== undefined;
}
