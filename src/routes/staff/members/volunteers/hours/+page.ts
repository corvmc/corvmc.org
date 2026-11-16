import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** The hour-log queue is part of Volunteering (#2765). Filters ride along. */
export const load: PageLoad = ({ url }) => {
	redirect(308, `/staff/volunteering/hours${url.search}`);
};
