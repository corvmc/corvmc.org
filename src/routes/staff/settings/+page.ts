import { redirect } from '@sveltejs/kit';

/**
 * Settings' tabs moved to the modules they configure (#2586, #2763) and the
 * System panel; old links land where each tab went.
 */
const MOVED: Record<string, string> = {
	integrations: '/staff/building-access',
	pricing: '/staff/reservations/settings',
	reservations: '/staff/reservations/settings',
	organization: '/staff/system/organization',
	features: '/staff/system/features',
	access: '/staff/system/access',
	inbox: '/staff/inbox/channels',
	subscriptions: '/staff/members'
};

export function load({ url }) {
	redirect(308, MOVED[url.searchParams.get('tab') ?? ''] ?? '/staff/system');
}
