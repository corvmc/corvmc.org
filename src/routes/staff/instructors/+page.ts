import { redirect } from '@sveltejs/kit';

// Instructors became a Members view (#2074).
export function load({ url }) {
	redirect(308, `/staff/members/instructors${url.search}`);
}
