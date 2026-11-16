import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { groupListRedirect } from '../views';

/** An address from before the Groups list (#2765); bands are listed on their own (#3027). */
export const load: PageLoad = ({ url }) => {
	redirect(308, groupListRedirect('band', url.search));
};
