import { redirect } from '@sveltejs/kit';
import { volunteeringTarget } from '../../volunteering/redirect-target';
import type { PageLoad } from './$types';

/** The Schedule split in two (#2625): shifts are Volunteering, the rest is Tasks. */
export const load: PageLoad = ({ url }) => {
	redirect(308, volunteeringTarget(url.searchParams));
};
