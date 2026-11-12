import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../views';

export const outreachViews: readonly StaffView<'campaigns' | 'audiences' | 'posters'>[] = [
	{
		key: 'campaigns',
		label: () => m.staff_marketing_campaigns_label(),
		href: resolve('staff/marketing/campaigns'),
		cap: 'marketing.read'
	},
	{
		key: 'audiences',
		label: () => m.staff_audiences_label(),
		href: resolve('staff/marketing/audiences'),
		cap: 'marketing.manageAudiences'
	},
	{
		key: 'posters',
		label: () => m.staff_posters_label(),
		href: resolve('staff/marketing/posters'),
		cap: 'marketing.read'
	}
];
