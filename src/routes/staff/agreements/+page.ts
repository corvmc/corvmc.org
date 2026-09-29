import { redirect } from '@sveltejs/kit';

/**
 * The Agreements nav row groups Sponsors, Grants and Renewals and has no page
 * of its own. Its first child is where it lands.
 */
export function load() {
	redirect(307, '/staff/sponsors');
}
