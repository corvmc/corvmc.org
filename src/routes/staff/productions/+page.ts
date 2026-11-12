import { redirect } from '@sveltejs/kit';

// Productions became a Projects view (#2101), now a Tasks view (#2625).
export function load({ url }) {
	redirect(308, `/staff/tasks/productions${url.search}`);
}
