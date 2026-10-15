import { redirect } from '@sveltejs/kit';

/**
 * Recurring work folded into Schedule as a filter: what it writes are work orders,
 * and Schedule is the one list of those (#1933). The definitions show above the
 * table while the filter is on. #1796 may yet move them out of Volunteering.
 */
export function load() {
	redirect(308, '/staff/volunteer/schedule?kind=recurring');
}
