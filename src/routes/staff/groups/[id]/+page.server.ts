import { redirect } from '@sveltejs/kit';
import { getGroupDetail } from '$lib/server/group/group-service';
import type { PageServerLoad } from './$types';

/**
 * A group's old staff address, sent on to its committee or club page. A server
 * `load` because the target depends on the group's kind: this is navigation,
 * like `/m/[memberNumber]`, and the page it lands on runs its own guard.
 */
export const load: PageServerLoad = async ({ params }) => {
	const group = await getGroupDetail(params.id);
	redirect(
		308,
		group?.kind === 'committee' ? `/staff/committees/${params.id}` : `/staff/clubs/${params.id}`
	);
};
