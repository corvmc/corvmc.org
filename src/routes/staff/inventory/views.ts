import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

/**
 * The Equipment row's lists, one per object (#2573, #2767). Kits are a filter on
 * Loans and Form 8282 one on Acquisitions. Each keeps its remotes' capability.
 */
export const gearViews: readonly StaffView<
	'items' | 'loans' | 'problems' | 'orders' | 'acquisitions'
>[] = [
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
		key: 'orders',
		label: () => m.staff_gear_orders_label(),
		href: resolve('staff/inventory/orders'),
		cap: 'inventory.read'
	},
	{
		key: 'acquisitions',
		label: () => m.staff_acquisitions_label(),
		href: resolve('staff/inventory/acquisitions'),
		cap: 'inventory.manageAcquisitions'
	}
];
