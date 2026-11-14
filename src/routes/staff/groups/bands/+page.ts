import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { groupViewRedirect } from '../views';

/** Bands are a kind filter on the Groups list (#2765); old links land there. */
export const load: PageLoad = ({ url }) => {
	redirect(308, groupViewRedirect('band', url.search));
};
