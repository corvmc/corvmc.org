import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** A sponsor's page is its organization's page in Contacts, at its sponsorships (#2764). */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/staff/contacts/${params.id}#sponsorships`);
};
