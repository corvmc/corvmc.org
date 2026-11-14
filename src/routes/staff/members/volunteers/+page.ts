import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { memberViewRedirect } from '../views';

/** Volunteers is a filter on the Members list (#2765); old links land there. */
export const load: PageLoad = ({ url }) => {
	redirect(308, memberViewRedirect('volunteer', url.search));
};
