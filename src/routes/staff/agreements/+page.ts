import { redirect } from '@sveltejs/kit';

/**
 * Agreements was a nav grouping of Sponsors and Grants, never a page. Both are
 * on the Funding page now (#2622); this keeps old links landing.
 */
export function load() {
	redirect(307, '/staff/funding');
}
