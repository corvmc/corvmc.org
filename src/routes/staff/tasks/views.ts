import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export type TaskViewKey = 'tasks' | 'projects';

/**
 * The Tasks row's lists (#2625): tasks, and the projects that group them.
 * Recurring work and templates generate tasks, so they are its settings (#2767).
 */
export const taskViews: readonly StaffView<TaskViewKey>[] = [
	{
		key: 'tasks',
		label: () => m.staff_tasks_label(),
		href: resolve('staff/tasks'),
		cap: 'project.read'
	},
	{
		key: 'projects',
		label: () => m.staff_projects_label(),
		href: resolve('staff/tasks/projects'),
		cap: 'project.read'
	}
];
