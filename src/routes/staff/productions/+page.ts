import { redirect } from '@sveltejs/kit';

// Productions became a Projects view (#2101).
export function load({ url }) {
	redirect(308, `/staff/projects/productions${url.search}`);
}
