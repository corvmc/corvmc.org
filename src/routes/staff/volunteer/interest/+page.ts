import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * The interest table was folded into the roles page, and the people half of it
 * came back as the volunteers index. Points there rather than at the roles
 * page: a bookmark to this URL was always after names, not roles.
 */
export const load: PageLoad = () => {
	redirect(308, '/staff/members?role=volunteer');
};
