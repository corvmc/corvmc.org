import { resolve } from '$app/paths';
import type { StaffNavItem } from './types';

export type BottomNavKey = 'reports' | 'settings';

/** Rows below the last section, outside any of the four systems. */
export const staffNavBottom: StaffNavItem[] = [
	// Each view has its own gate (#2396).
	{
		key: 'reports',
		capability: 'finance.read',
		alsoFor: ['volunteer.report', 'inventory.report', 'music.read'],
		label: 'Reports',
		href: resolve('staff/reports'),
		also: [resolve('staff/inventory/spend')]
	},
	// Opens the System panel, which swaps this sidebar for its own. The key
	// stays `settings`, which starred rows store.
	{
		key: 'settings',
		capability: 'settings.read',
		alsoFor: ['user.setRole', 'audit.read'],
		label: 'System',
		href: resolve('staff/system')
	}
];
