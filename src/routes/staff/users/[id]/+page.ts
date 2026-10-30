import { redirect } from '@sveltejs/kit';

// Users became Members (#2074); `?tab=` carries over.
export function load({ params, url }) {
	redirect(308, `/staff/members/${params.id}${url.search}`);
}
