import { redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authorization';
import type { PageServerLoad } from './$types';

/**
 * Bands needs `band.read`; a staffer without it goes to the first view they hold.
 * Navigation only: every view's remotes guard for themselves.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || (await can('band.read'))) return;
	if (await can('group.read')) redirect(307, '/staff/groups/clubs');
	if (await can('committee.reviewApplications')) redirect(307, '/staff/groups/committees');
};
