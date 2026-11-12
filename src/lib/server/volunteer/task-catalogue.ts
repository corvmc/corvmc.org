import { db } from '#lib/server/db/index.js';
import { workOrder, volunteerRole } from '#lib/server/db/schema/volunteer.js';
import { project } from '#lib/server/db/schema/project.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { and, asc, eq, exists, isNull, or, sql } from 'drizzle-orm';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { engagementViewWhere } from '#lib/server/contractor/contractor-job-service.js';
import type { ProjectKind, ProjectStatus } from '#lib/config.js';
import { assigneeCountSql, capacitySql, claimedSql } from './work-order-service';

/** One row of the Tasks table (#2625): a task, whatever project it is in, if any. */
export interface TaskRow {
	id: string;
	title: string | null;
	volunteerRoleId: string | null;
	roleName: string | null;
	eventId: string | null;
	eventTitle: string | null;
	projectId: string | null;
	projectName: string | null;
	projectKind: ProjectKind | null;
	projectStatus: ProjectStatus | null;
	dueAt: Date | null;
	/** The next live shift still to end, else the last live one; null with no live shift. */
	shiftAt: Date | null;
	/** Live shifts on the task. */
	shifts: number;
	/** Places across its live shifts, and how many are taken. */
	capacity: number;
	claimed: number;
	assignees: number;
	maintenanceScheduleId: string | null;
	pendingCapacity: number | null;
	resolvedAt: Date | null;
	createdAt: Date;
}

export interface TaskCatalogueFilters {
	volunteerRoleId?: string;
	/** Done tasks are left out unless asked for. Cancelled ones always are. */
	includeDone?: boolean;
	/** Done work still awaiting a contractor's invoice is included either way. */
	withAwaitingInvoice?: boolean;
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

/**
 * Every task that is not called off: in a project or not, staffed by shifts,
 * assignees or a contractor, or by nobody yet. Ordered by creation; the table
 * sorts and groups it.
 */
export async function listTaskCatalogue(
	filters: TaskCatalogueFilters = {},
	now = new Date()
): Promise<TaskRow[]> {
	const nowSeconds = Math.floor(now.getTime() / 1000);
	const open = filters.includeDone ? undefined : isNull(workOrder.resolvedAt);
	const also = filters.withAwaitingInvoice ? awaitingInvoice(now) : undefined;

	const rows = await db
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
			maintenanceScheduleId: workOrder.maintenanceScheduleId,
			pendingCapacity: workOrder.pendingCapacity,
			resolvedAt: workOrder.resolvedAt,
			createdAt: workOrder.createdAt
		})
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.leftJoin(project, eq(project.id, workOrder.projectId))
		.where(
			and(
				isNull(workOrder.cancelledAt),
				filters.volunteerRoleId
					? eq(workOrder.volunteerRoleId, filters.volunteerRoleId)
					: undefined,
				open && also ? or(open, also) : open
			)
		)
		.orderBy(asc(workOrder.createdAt), asc(workOrder.id));

	return rows.map((r) => ({
		...r,
		shifts: Number(r.shifts),
		capacity: Number(r.capacity),
		claimed: Number(r.claimed),
		assignees: Number(r.assignees)
	}));
}
