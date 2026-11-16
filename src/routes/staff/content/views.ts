import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

/** Content is one row with two views (#2765); each keeps its own address and gate. */
export const contentViews: readonly StaffView<'help' | 'resources'>[] = [
	{
		key: 'help',
		label: () => m.staff_content_help_label(),
		href: resolve('staff/help'),
		cap: 'help.read'
	},
	{
		key: 'resources',
		label: () => m.staff_content_resources_label(),
		href: resolve('staff/local-resources'),
		cap: 'localResource.manage'
	}
];
