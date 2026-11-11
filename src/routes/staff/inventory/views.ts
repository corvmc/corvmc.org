import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

/** The Gear row's tabs (#2573). Each keeps the capability its page's remotes check. */
export const gearViews: readonly StaffView<'items' | 'loans' | 'problems' | 'compliance'>[] = [
	{
		key: 'items',
		label: () => m.staff_items_label(),
		href: resolve('staff/inventory'),
		cap: 'inventory.read'
	},
	{
		key: 'loans',
		label: () => m.staff_gear_loans_label(),
		href: resolve('staff/inventory/loans'),
		cap: 'inventory.manageLoans'
	},
	{
		key: 'problems',
		label: () => m.staff_gear_problems_label(),
		href: resolve('staff/inventory/problems'),
		cap: 'inventory.manageAssets'
	},
	{
		key: 'compliance',
		label: () => m.staff_gear_compliance_label(),
		href: resolve('staff/inventory/compliance'),
		cap: 'inventory.manageAcquisitions'
	}
];
