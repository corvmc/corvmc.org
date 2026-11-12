import { redirect } from '@sveltejs/kit';

/** Tabs that moved to the Practice space page (#2586), so old links still land. */
export function load({ url }) {
	if (url.searchParams.get('tab') === 'integrations') redirect(308, '/staff/reservations?access');
}
