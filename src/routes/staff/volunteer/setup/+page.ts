import { redirect } from '@sveltejs/kit';

/** Setup was renamed Roles (#1791); the query carries `?retired=1` across. */
export function load({ url }) {
	redirect(308, `/staff/volunteer/roles${url.search}`);
}
