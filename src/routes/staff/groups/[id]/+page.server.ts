import { error, redirect } from '@sveltejs/kit';
import { getGroupDetail } from '#lib/server/group/group-service.js';
import type { PageServerLoad } from './$types';
import { groupRecordRedirect } from '../views';

/**
 * Every record is under its kind's list (#3027). Navigation only: each kind's
 * record runs its own guarded query.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const group = await getGroupDetail(params.id);
	if (!group) error(404, 'Group not found');
	redirect(308, groupRecordRedirect(group.kind, group.id, url.search));
};
