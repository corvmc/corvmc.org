import { redirect } from '@sveltejs/kit';

/** Recurring work moved beside Projects (#1796); this address may be bookmarked. */
export function load() {
	redirect(308, '/staff/recurring-work');
}
