import { redirect } from '@sveltejs/kit';

/** Recurring work is a view of Tasks (#2087, #2625); this address may be bookmarked. */
export function load() {
	redirect(308, '/staff/tasks/recurring');
}
