import { redirect } from '@sveltejs/kit';

/** The hours queue is a Members → Volunteers view (#2075). Filters ride along. */
export function load({ url }) {
	redirect(308, `/staff/members/volunteers/hours${url.search}`);
}
