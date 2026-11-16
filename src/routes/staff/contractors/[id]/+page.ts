import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** A contractor's page is its organization's page in Contacts (#2764). */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/staff/contacts/${params.id}`);
};
