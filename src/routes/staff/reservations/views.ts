import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export type SpaceViewKey = 'reservations' | 'recurring' | 'building-access';

/**
 * The Practice space row's views (#2766): the bookings and closures, the series
 * that make bookings, and who can get into the building.
 */
export const spaceViews: readonly StaffView<SpaceViewKey>[] = [
	{
		key: 'reservations',
		label: () => m.staff_space_views_reservations_label(),
		href: resolve('staff/reservations'),
		cap: 'reservation.read'
	},
	{
		key: 'recurring',
		label: () => m.staff_recurring_series_label(),
		href: resolve('staff/recurring'),
		cap: 'reservation.read'
	},
	{
		key: 'building-access',
		label: () => m.staff_reservations_building_access_label(),
		href: resolve('staff/building-access'),
		cap: 'lock.manage'
	}
];
