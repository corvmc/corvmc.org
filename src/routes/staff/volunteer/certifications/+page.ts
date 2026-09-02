import { redirect } from '@sveltejs/kit';

/**
 * The certification catalog folded into Setup. A clearance exists because some
 * role requires it, so the two belong on one screen; who *holds* one is a fact
 * about a person and lives on People's Cleared tab.
 */
export function load() {
	redirect(308, '/staff/volunteer/setup');
}
