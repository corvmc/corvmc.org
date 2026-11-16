import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { groupListRedirect, groupView } from './views';

/** Bands, clubs and committees are listed apart (#3027); the kind filter's links land there. */
export const load: PageLoad = ({ url }) => {
	redirect(308, groupListRedirect(groupView(url.searchParams), url.search));
};
