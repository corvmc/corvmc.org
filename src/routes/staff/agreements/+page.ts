import { redirect } from '@sveltejs/kit';

/**
 * Agreements was a nav grouping of Sponsors and Grants, never a page.
 * The rows now live in their own sections; this keeps old links landing.
 */
export function load() {
	redirect(307, '/staff/sponsors');
}
