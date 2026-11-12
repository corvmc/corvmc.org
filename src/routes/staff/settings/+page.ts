import { redirect } from '@sveltejs/kit';

/** Tabs that moved to the Practice space pages (#2586), so old links still land. */
const MOVED: Record<string, string> = {
	integrations: '/staff/reservations?access',
	pricing: '/staff/reservations/settings',
	reservations: '/staff/reservations/settings'
};

export function load({ url }) {
	const to = MOVED[url.searchParams.get('tab') ?? ''];
	if (to) redirect(308, to);
}
