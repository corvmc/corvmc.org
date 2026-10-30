import { redirect } from '@sveltejs/kit';

// Users became Members, which also holds the volunteer and instructor views (#2074).
export function load({ url }) {
	redirect(308, `/staff/members${url.search}`);
}
