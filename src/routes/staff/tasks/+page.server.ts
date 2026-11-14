import { redirect } from '@sveltejs/kit';
import { can } from '#lib/server/authorization.js';
import type { PageServerLoad } from './$types';

/**
 * Tasks needs `project.read`; a staffer holding only `event.manage` goes to
 * Productions on Events (#2766). Navigation only: each view's remotes guard for themselves.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || (await can('project.read'))) return;
	if (await can('event.manage')) redirect(307, '/staff/events?view=productions');
};
