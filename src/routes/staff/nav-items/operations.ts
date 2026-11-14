import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type OperationsNavKey = 'projects' | 'volunteer-schedule' | 'gear' | 'supplies' | 'payments';

export const operations: StaffNavSection = {
	key: 'operations',
	title: 'Operations',
	items: [
		// Every task, with Projects as a view (#2625) and recurring work and
		// templates as its settings (#2767). The key stays `projects`, which
		// starred rows store.
		{
			key: 'projects',
			capability: 'project.read',
			label: 'Tasks',
			href: resolve('staff/tasks')
		},
		// Volunteer shifts (#2625): signing people up and closing shifts out.
		// It keeps the rest of `/staff/volunteer` (roles, clearances) and the
		// key `volunteer-schedule`, which starred rows store.
		{
			key: 'volunteer-schedule',
			capability: 'volunteer.read',
			label: 'Volunteering',
			href: resolve('staff/volunteering'),
			also: [resolve('staff/volunteer')],
			badgeKey: 'volunteerPending'
		},
		// Equipment is what is tracked unit by unit or lent out; Supplies is what
		// is used up (#2573, predicate in `server/inventory/sections.ts`). Loans,
		// problems, orders and acquisitions are Equipment's other lists (#2767).
		{
			key: 'gear',
			capability: 'inventory.read',
			label: 'Equipment',
			href: resolve('staff/inventory')
		},
		{
			key: 'supplies',
			capability: 'inventory.read',
			label: 'Supplies',
			href: resolve('staff/inventory/supplies')
		},
		// Payments and Credits are its views, each with its own gate (#2395).
		{
			key: 'payments',
			capability: 'finance.read',
			alsoFor: ['credit.read'],
			label: 'Money',
			href: resolve('staff/money')
		}
	]
};
