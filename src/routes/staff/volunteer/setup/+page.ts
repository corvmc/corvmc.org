import { redirect } from '@sveltejs/kit';
import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

/** Setup was renamed Roles (#1791); the query carries `?retired=1` across. */
export function load({ url }) {
	redirect(308, pastCachedRedirect(`/staff/volunteer/roles${url.search}`, 'setup'));
}
