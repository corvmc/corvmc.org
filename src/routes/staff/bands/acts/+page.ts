import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Outside acts are performer organizations (#2683): Contacts' performer role (#2765). */
export const load: PageLoad = () => {
	redirect(308, '/staff/contacts?role=performer');
};
