import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { groupViewPath } from '../views';

/** Committees are a kind filter on the Groups list (#2765); old links land there. */
export const load: PageLoad = ({ url }) => {
	redirect(308, groupViewPath('committee', url.search));
};
