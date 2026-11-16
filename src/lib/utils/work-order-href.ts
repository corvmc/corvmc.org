export type WorkOrderPath = `/staff/tasks/${string}`;

/**
 * A work order's staff page. Every task has one, in a project or not (#2625),
 * so the address no longer moves when a work order moves onto a project.
 */
export function workOrderHref(wo: { id: string }): WorkOrderPath {
	return `/staff/tasks/${wo.id}`;
}

type Unslashed<T> = T extends `/${infer P}` ? P : never;

/** `workOrderHref` as a pathname for `resolve()`, which reads a leading `/` as a route ID. */
export function workOrderPathname(wo: { id: string }): Unslashed<WorkOrderPath> {
	return workOrderHref(wo).slice(1) as Unslashed<WorkOrderPath>;
}
