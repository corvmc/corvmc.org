import { db } from '#lib/server/db/index.js';
import { workOrder, volunteerRole } from '#lib/server/db/schema/volunteer.js';
import { workOrderLink } from '#lib/server/db/schema/work-order-link.js';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { and, eq, isNotNull, isNull, sql, type AnyColumn } from 'drizzle-orm';
import { lastActivityByOrganization } from './activity-service';

/**
 * The Contacts list's two facts per organization (#2622): the day of its latest
 * note, and its next open task. An organization's tasks are the ones the
 * related-tasks registry finds for it: linked to it, its contractor jobs, and
 * the tasks on its grants' and sponsorships' projects.
 */

export interface NextTask {
	id: string;
	title: string;
	dueAt: Date | null;
}

const open = and(isNull(workOrder.resolvedAt), isNull(workOrder.cancelledAt));
const columns = (organizationId: AnyColumn) => ({
	organizationId: sql<string>`${organizationId}`.as('organization_id'),
	id: workOrder.id,
	title: sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name}, 'Task')`.as('title'),
	dueAt: workOrder.dueAt,
	createdAt: workOrder.createdAt
});

/** Every open task each organization has, read in one pass rather than bound per id. */
function openTasksByOrganization() {
	const linked = db
		.select(columns(workOrderLink.organizationId))
		.from(workOrderLink)
		.innerJoin(workOrder, eq(workOrder.id, workOrderLink.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(and(isNotNull(workOrderLink.organizationId), open));
	const jobs = db
		.select(columns(contractorJob.organizationId))
		.from(contractorJob)
		.innerJoin(workOrder, eq(workOrder.id, contractorJob.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(open);
	const grants = db
		.select(columns(grantApplication.organizationId))
		.from(grantApplication)
		.innerJoin(workOrder, eq(workOrder.projectId, grantApplication.projectId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(open);
	const sponsorships = db
		.select(columns(sponsorship.organizationId))
		.from(sponsorship)
		.innerJoin(workOrder, eq(workOrder.projectId, sponsorship.projectId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(open);
	return linked.unionAll(jobs).unionAll(grants).unionAll(sponsorships);
}

/** Soonest due first; a task with no due date after every dated one, then oldest. */
const sooner = (a: NextTask & { createdAt: Date }, b: NextTask & { createdAt: Date }) =>
	(a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
	a.createdAt.getTime() - b.createdAt.getTime();

export async function nextTaskByOrganization(ids: string[]): Promise<Map<string, NextTask>> {
	if (ids.length === 0) return new Map();
	const wanted = new Set(ids);
	const best = new Map<string, NextTask & { createdAt: Date }>();
	for (const row of await openTasksByOrganization()) {
		if (!wanted.has(row.organizationId)) continue;
		const held = best.get(row.organizationId);
		if (!held || sooner(row, held) < 0) best.set(row.organizationId, row);
	}
	return new Map([...best].map(([org, t]) => [org, { id: t.id, title: t.title, dueAt: t.dueAt }]));
}

export async function organizationListFacts(ids: string[]) {
	const [last, next] = await Promise.all([
		lastActivityByOrganization(ids),
		nextTaskByOrganization(ids)
	]);
	return { lastActivity: last, nextTask: next };
}
