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
