import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export const moderationViews: readonly StaffView<'flags' | 'incidents'>[] = [
	{
		key: 'flags',
		label: () => m.staff_content_flags_label(),
		href: resolve('staff/moderation/flags'),
		cap: 'moderation.reviewFlags'
	},
	{
		key: 'incidents',
		label: () => m.staff_incidents_label(),
		href: resolve('staff/moderation/incidents'),
		cap: 'incident.read'
	}
];
