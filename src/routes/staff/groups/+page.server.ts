import { redirect } from '@sveltejs/kit';
import { can } from '#lib/server/authorization.js';
import type { PageServerLoad } from './$types';
import { groupView, groupViewPath } from './views';

/**
 * The band view needs `band.read`; a staffer without it gets the first kind they
 * hold. Navigation only: every view's remotes guard for themselves.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || groupView(url.searchParams) !== 'band' || (await can('band.read'))) return;
	if (await can('group.read')) redirect(307, groupViewPath('club'));
	if (await can('committee.reviewApplications')) redirect(307, groupViewPath('committee'));
};
