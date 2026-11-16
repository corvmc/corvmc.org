import { resolve } from '$app/paths';
import type { StaffNavItem } from './types';

export type SystemNavKey = 'organization' | 'features' | 'access' | 'audit';

/**
 * The System panel's sidebar (#2763): only what spans modules. A module's own
 * settings live on its row, so nothing here names one.
 */
export const systemNavItems: StaffNavItem[] = [
	{
		key: 'organization',
		capability: 'settings.read',
		label: 'Organization',
		href: resolve('staff/system/organization')
	},
	{
		key: 'features',
		capability: 'settings.read',
		label: 'Features',
		href: resolve('staff/system/features')
	},
	{
		key: 'access',
		capability: 'user.setRole',
		label: 'Access',
		href: resolve('staff/system/access')
	},
	{
		key: 'audit',
		capability: 'audit.read',
		label: 'Audit log',
		href: resolve('staff/system/audit')
	}
];
