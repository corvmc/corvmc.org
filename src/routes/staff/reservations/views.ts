import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export type SpaceViewKey = 'reservations' | 'recurring';

/**
 * The Practice space row's views (#2766): the bookings and closures, and the
 * series that make bookings. Building access is a settings tab (#3102).
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
	}
];
