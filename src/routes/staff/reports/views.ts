import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

type ReportView = 'annual' | 'volunteering' | 'inventory-spend' | 'acquisitions';

// Separate gates, so the fold does not reopen #2154: the Annual report's money
// lines decide who opens it, and the others have their own capability.
export const reportViews: readonly StaffView<ReportView>[] = [
	{
		key: 'annual',
		label: () => m.staff_reports_annual_label(),
		href: resolve('staff/reports/annual'),
		cap: 'finance.read'
	},
	{
		key: 'volunteering',
		label: () => m.staff_reports_volunteering_volunteering_label(),
		href: resolve('staff/reports/volunteering'),
		cap: 'volunteer.report'
	},
	{
		key: 'inventory-spend',
		label: () => m.staff_reports_inventory_spend_label(),
		href: resolve('staff/reports/inventory-spend'),
		cap: 'inventory.report'
	},
	{
		key: 'acquisitions',
		label: () => m.staff_acquisitions_label(),
		href: resolve('staff/reports/acquisitions'),
		cap: 'inventory.manageAcquisitions'
	}
];
