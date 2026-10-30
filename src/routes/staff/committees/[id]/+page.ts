import { redirect } from '@sveltejs/kit';

// Every group's record is at /staff/groups/[id] (#2086).
export function load({ params, url }) {
	redirect(308, `/staff/groups/${params.id}${url.search}`);
}
