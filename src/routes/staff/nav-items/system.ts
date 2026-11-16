import { resolve } from '$app/paths';
import type { StaffNavItem } from './types';

export type SystemNavKey = 'organization' | 'access' | 'payments' | 'audit';

/**
 * The System panel's sidebar (#2763): only what spans modules. A module's own
 * settings live on its row, so nothing here names one. Transactions is the
 * payment log, opened to troubleshoot a payment (#3112).
 */
export const systemNavItems: StaffNavItem[] = [
	{
		key: 'organization',
		capability: 'settings.read',
		label: 'Organization',
		href: resolve('staff/system/organization')
	},
	{
		key: 'access',
		capability: 'user.setRole',
		label: 'Access',
		href: resolve('staff/system/access')
	},
	// Payments and Credits are its views, each with its own gate (#2395). The
	// key stays `payments`, which starred rows store.
	{
		key: 'payments',
		capability: 'finance.read',
		alsoFor: ['credit.read'],
		label: 'Transactions',
		href: resolve('staff/system/transactions')
	},
	{
		key: 'audit',
		capability: 'audit.read',
		label: 'Audit log',
		href: resolve('staff/system/audit')
	}
];
