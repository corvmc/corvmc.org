import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Bands left this page for their own (#2115); the old tab's links land there. */
export const load: PageLoad = ({ url }) => {
	if (url.searchParams.get('tab') === 'bands') redirect(308, '/member/directory/bands');
};
