import { redirect } from '@sveltejs/kit';

/** The hour-log queue is part of Volunteering (#2765). Filters ride along. */
export function load({ url }) {
	redirect(308, `/staff/volunteering/hours${url.search}`);
}
