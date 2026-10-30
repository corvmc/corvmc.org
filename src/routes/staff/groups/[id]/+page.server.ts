import { error } from '@sveltejs/kit';
import { getGroupDetail } from '$lib/server/group/group-service';
import type { PageServerLoad } from './$types';

/**
 * Which kind's record to render. Navigation only, like `/m/[memberNumber]`:
 * each kind's record runs its own guarded query.
 */
export const load: PageServerLoad = async ({ params }) => {
	const group = await getGroupDetail(params.id);
	if (!group) error(404, 'Group not found');
	return { kind: group.kind };
};
