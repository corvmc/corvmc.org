import { redirect } from '@sveltejs/kit';

/**
 * The interest table was folded into the roles page, and the people half of it
 * came back as the volunteers index. Points there rather than at the roles
 * page: a bookmark to this URL was always after names, not roles.
 */
export function load() {
	redirect(308, '/staff/volunteer/people');
}
