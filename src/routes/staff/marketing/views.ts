import { resolve } from '$app/paths';
import { m } from '$lib/paraglide/messages.js';
import type { StaffView } from '../views';

export const outreachViews: readonly StaffView<'campaigns' | 'audiences'>[] = [
	{
		key: 'campaigns',
		label: () => m.staff_marketing_campaigns_title(),
		href: resolve('/staff/marketing/campaigns'),
		cap: 'marketing.read'
	},
	{
		key: 'audiences',
		label: () => m.staff_audiences(),
		href: resolve('/staff/marketing/audiences'),
		cap: 'marketing.manageAudiences'
	}
];
