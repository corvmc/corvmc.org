import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../../views';

export type SettingsViewKey = 'booking' | 'building-access';

/**
 * Practice space settings' tabs (#3102). Building access is `lock.manage`'s
 * alone, so a viewer without `settings.read` still reaches it.
 */
export const settingsViews: readonly StaffView<SettingsViewKey>[] = [
	{
		key: 'booking',
		label: () => m.staff_reservations_settings_booking_label(),
		href: resolve('staff/reservations/settings'),
		cap: 'settings.read'
	},
	{
		key: 'building-access',
		label: () => m.staff_reservations_building_access_label(),
		href: resolve('staff/reservations/settings/building-access'),
		cap: 'lock.manage'
	}
];
