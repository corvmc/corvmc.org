import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Contractors are the Contacts list's contractor role (#2764); old links land there. */
export const load: PageLoad = () => {
	redirect(308, '/staff/contacts?role=contractor');
};
