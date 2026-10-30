import { redirect } from '@sveltejs/kit';

/** Recurring work is a view of the Schedule (#2087); this address may be bookmarked. */
export function load() {
	redirect(308, '/staff/volunteer/schedule/recurring');
}
