import { redirect } from '@sveltejs/kit';
import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

/**
 * The certification catalog folded into Roles. A clearance exists because some
 * role requires it, so the two belong on one screen; who *holds* one is a fact
 * about a person: People's Clearance filter.
 */
export function load() {
	redirect(308, pastCachedRedirect('/staff/volunteer/roles', 'certifications'));
}
