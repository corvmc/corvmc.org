import { redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authorization';
import type { PageServerLoad } from './$types';

/**
 * All needs `user.list`; a staffer without it goes to the first view they hold.
 * Navigation only: every view's remotes guard for themselves, and a caller with
 * none of them stays here to be refused by the list query.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || (await can('user.list'))) return;
	if (await can('volunteer.read')) redirect(307, '/staff/members/volunteers');
};
