import { redirect } from '@sveltejs/kit';

/** Recurring work is a view of Tasks (#2087, #2625); `?id` opens one in the panel. */
export function load({ url }) {
	redirect(308, `/staff/tasks/recurring${url.search}`);
}
