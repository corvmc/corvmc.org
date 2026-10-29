import { redirect } from '@sveltejs/kit';
import { contractorJobViews } from '$lib/config';
import type { PageLoad } from './$types';

/**
 * The jobs list is the Schedule's contractor filter (#2069). An old `?view=`
 * link lands on the same filter; Open is that filter's default, so it is dropped.
 */
export const load: PageLoad = ({ url }) => {
	const view = url.searchParams.get('view');
	const keep = view && view !== 'open' && contractorJobViews.includes(view as never);
	redirect(308, `/staff/volunteer/schedule?kind=contractor${keep ? `&contractor=${view}` : ''}`);
};
