import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Funders are the Contacts list's funder role (#2764); old links land there. */
export const load: PageLoad = () => {
	redirect(308, '/staff/contacts?role=funder');
};
