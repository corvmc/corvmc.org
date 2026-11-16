import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { legacyContactsHref } from './contact-filters';

/** The page had a tab per role (`?view=`) until #2760; those links land on the role filter. */
export const load: PageLoad = ({ url }) => {
	const href = legacyContactsHref(url);
	if (href) redirect(308, href);
};
