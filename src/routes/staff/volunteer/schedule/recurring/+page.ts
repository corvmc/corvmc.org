import { redirect } from '@sveltejs/kit';

/** Recurring work moved to Tasks (#2625); `?id` opens one in the panel. */
export function load({ url }) {
	redirect(308, `/staff/tasks/recurring${url.search}`);
}
