import { db } from '#lib/server/db/index.js';
import { workOrder, volunteerRole } from '#lib/server/db/schema/volunteer.js';
import { project } from '#lib/server/db/schema/project.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { and, asc, eq, exists, isNull, or, sql, type SQL } from 'drizzle-orm';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { engagementViewWhere } from '#lib/server/contractor/contractor-job-service.js';
import type { TaskRow } from '#lib/utils/task-facts.js';
import { assigneeCountSql, capacitySql, claimedSql } from './work-order-service';
import { openBlockersSql } from './task-dependencies';

export type { TaskRow };

export interface TaskCatalogueFilters {
	/** One project's tasks, as its page lists them. */
	projectId?: string;
	volunteerRoleId?: string;
	/** Done tasks are left out unless asked for. Cancelled ones always are. */
	includeDone?: boolean;
	/** Done work still awaiting a contractor's invoice is included either way. */
	withAwaitingInvoice?: boolean;
	/** Narrows to the tasks related to one record (`relatedTaskWhere`, #2630). */
	where?: SQL;
}

function liveShiftsWhere() {
	return sql`s."work_order_id" = ${workOrder.id} and s."cancelled_at" is null`;
}

/** The task has an engagement in the contractor list's own awaiting-invoice view. */
function awaitingInvoice(now: Date) {
	return exists(
		db
			.select({ one: sql`1` })
			.from(contractorJob)
			.where(
				and(
					eq(contractorJob.workOrderId, workOrder.id),
					engagementViewWhere('awaiting-invoice', now)
				)
			)
	);
}

/** The Tasks table's row, selected and joined; callers add the `where`. */
export function taskRowQuery(now: Date) {
	const nowSeconds = Math.floor(now.getTime() / 1000);
	return db
		.select({
			id: workOrder.id,
			title: workOrder.title,
			volunteerRoleId: workOrder.volunteerRoleId,
			roleName: volunteerRole.name,
			eventId: workOrder.eventId,
			eventTitle: eventListing.title,
			projectId: workOrder.projectId,
			projectName: project.name,
			projectKind: project.kind,
			projectStatus: project.status,
			dueAt: workOrder.dueAt,
			shiftAt: sql<Date | null>`coalesce(
				(select min(s."starts_at") from "volunteer_shift" s
					where ${liveShiftsWhere()} and s."ends_at" > ${nowSeconds}),
				(select max(s."starts_at") from "volunteer_shift" s where ${liveShiftsWhere()})
			)`.mapWith(workOrder.dueAt),
			shifts: sql<number>`(select count(*) from "volunteer_shift" s where ${liveShiftsWhere()})`,
			capacity: capacitySql(),
			claimed: claimedSql(),
			assignees: assigneeCountSql(),
			blockers: openBlockersSql(),
			maintenanceScheduleId: workOrder.maintenanceScheduleId,
			pendingCapacity: workOrder.pendingCapacity,
			resolvedAt: workOrder.resolvedAt,
			createdAt: workOrder.createdAt
		})
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.leftJoin(project, eq(project.id, workOrder.projectId));
}

type RawTaskRow = Awaited<ReturnType<typeof taskRowQuery>>[number];

/** SQLite hands the counts back as whatever the driver likes; the row says number. */
export function toTaskRow(r: RawTaskRow): TaskRow {
	return {
		...r,
		shifts: Number(r.shifts),
		capacity: Number(r.capacity),
		claimed: Number(r.claimed),
		assignees: Number(r.assignees),
		blockers: Number(r.blockers)
	};
}

/**
 * Every task that is not called off: in a project or not, staffed by shifts,
 * assignees or a contractor, or by nobody yet. Ordered by creation; the table
 * sorts and groups it.
 */
export async function listTaskCatalogue(
	filters: TaskCatalogueFilters = {},
	now = new Date()
): Promise<TaskRow[]> {
	const open = filters.includeDone ? undefined : isNull(workOrder.resolvedAt);
	const also = filters.withAwaitingInvoice ? awaitingInvoice(now) : undefined;

	const rows = await taskRowQuery(now)
		.where(
			and(
				isNull(workOrder.cancelledAt),
				filters.volunteerRoleId
					? eq(workOrder.volunteerRoleId, filters.volunteerRoleId)
					: undefined,
				filters.projectId ? eq(workOrder.projectId, filters.projectId) : undefined,
				filters.where,
				open && also ? or(open, also) : open
			)
		)
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id));

	return rows.map(toTaskRow);
}
