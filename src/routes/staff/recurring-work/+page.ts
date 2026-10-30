import { redirect } from '@sveltejs/kit';

/** Recurring work is a view of the Schedule (#2087); `?id` opens one in the panel. */
export function load({ url }) {
	redirect(308, `/staff/volunteer/schedule/recurring${url.search}`);
}
