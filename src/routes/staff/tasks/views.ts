import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export type TaskViewKey = 'tasks' | 'projects' | 'recurring' | 'productions' | 'templates';

/** The Tasks row's views (#2625): the table, then the things that group or generate tasks. */
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
	},
	{
		key: 'recurring',
		label: () => m.staff_recurring_label(),
		href: resolve('staff/tasks/recurring'),
		cap: 'volunteer.read'
	},
	{
		key: 'productions',
		label: () => m.staff_projects_project_views_productions_label(),
		href: resolve('staff/tasks/productions'),
		cap: 'event.manage'
	},
	{
		key: 'templates',
		label: () => m.staff_project_templates_templates_label(),
		href: resolve('staff/tasks/templates'),
		cap: 'project.read'
	}
];
