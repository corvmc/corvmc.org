import { redirect } from '@sveltejs/kit';
import { can } from '#lib/server/authorization.js';
import type { PageServerLoad } from './$types';
import { memberView, memberViewPath } from './views';

/**
 * The unfiltered list needs `user.list`; a staffer without it gets the first
 * role filter they hold. Navigation only: every view's remotes guard for
 * themselves, and a caller with none of them stays here to be refused.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || memberView(url.searchParams) !== 'all' || (await can('user.list'))) return;
	if (await can('volunteer.read')) redirect(307, memberViewPath('volunteer'));
	if (await can('instructor.read')) redirect(307, memberViewPath('teacher'));
};
