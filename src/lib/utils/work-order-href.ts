import { resolve } from '$app/paths';

export type WorkOrderPath =
	`/staff/projects/${string}/tasks/${string}` | `/staff/volunteer/shifts/${string}`;

/**
 * A work order's canonical staff page: its project's task page when it is on a
 * project, else the shift page. Nothing stores this, so moving a work order
 * onto or off a project moves its URL with it.
 */
export function workOrderHref(wo: { id: string; projectId: string | null }): WorkOrderPath {
	return wo.projectId
		? `/staff/projects/${wo.projectId}/tasks/${wo.id}`
		: `/staff/volunteer/shifts/${wo.id}`;
}

/** One engagement's card on its work order's page. */
export function engagementHref(job: { id: string; workOrderId: string; projectId: string | null }) {
	return `${resolve(workOrderHref({ id: job.workOrderId, projectId: job.projectId }))}#engagement-${job.id}`;
}
