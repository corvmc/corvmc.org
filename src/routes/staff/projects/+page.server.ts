import { redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authorization';
import type { PageServerLoad } from './$types';

/**
 * Projects needs `project.read`; a staffer holding only Productions' gate goes
 * there. Navigation only: each view's remotes guard for themselves.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || (await can('project.read'))) return;
	if (await can('event.manage')) redirect(307, '/staff/projects/productions');
};
