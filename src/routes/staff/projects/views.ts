import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export const projectViews: readonly StaffView<'projects' | 'productions' | 'templates'>[] = [
	{
		key: 'projects',
		label: () => m.staff_projects(),
		href: resolve('staff/projects'),
		cap: 'project.read'
	},
	{
		key: 'productions',
		label: () => m.staff_projects_project_views_productions(),
		href: resolve('staff/projects/productions'),
		cap: 'event.manage'
	},
	{
		key: 'templates',
		label: () => m.staff_project_templates_templates(),
		href: resolve('staff/projects/templates'),
		cap: 'project.read'
	}
];
