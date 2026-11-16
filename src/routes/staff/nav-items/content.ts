import { resolve } from '$app/paths';
import type { StaffNavItem } from './types';

export type ContentNavKey = 'help' | 'local-resources';

/**
 * The Content panel's sidebar (#3119), like System's. Each row keeps its own
 * address and gate; `/staff/content` opens the first one held.
 */
export const contentNavItems: StaffNavItem[] = [
	{
		key: 'help',
		capability: 'help.read',
		label: 'Help articles',
		href: resolve('staff/help')
	},
	{
		key: 'local-resources',
		capability: 'localResource.manage',
		label: 'Local resources',
		href: resolve('staff/local-resources')
	}
];
