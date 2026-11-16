import { resolve } from '$app/paths';
import { activeNavKey } from '#lib/components/layout/Nav/active-nav.js';
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

const contentRoots = [resolve('staff/content'), ...contentNavItems.map((i) => i.href)];

/** Whether a path is in the Content panel, which has its own sidebar. */
export function inContentPanel(pathname: string): boolean {
	return contentRoots.some((root) => pathname === root || pathname.startsWith(root + '/'));
}

/** Which Content row to light for a pathname. */
export function activeContentKey(pathname: string) {
	return activeNavKey(contentNavItems, pathname);
}
