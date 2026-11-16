import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export const moderationViews: readonly StaffView<'flags' | 'blocklist'>[] = [
	{
		key: 'flags',
		label: () => m.staff_content_flags_label(),
		href: resolve('staff/moderation/flags'),
		cap: 'moderation.reviewFlags'
	},
	{
		key: 'blocklist',
		label: () => m.staff_blocklist_label(),
		href: resolve('staff/moderation/blocklist'),
		cap: 'user.ban'
	}
];
