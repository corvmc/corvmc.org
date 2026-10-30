import { redirect } from '@sveltejs/kit';

// Bands, Clubs and Committees are views on Groups (#2086).
export function load({ url }) {
	redirect(308, `/staff/groups/committees${url.search}`);
}
