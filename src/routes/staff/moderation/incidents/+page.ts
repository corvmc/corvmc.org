import { redirect } from '@sveltejs/kit';
import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

// Incidents are a Governance row (#3112). `/staff/incidents` once 308'd here,
// so the target carries `via` past a browser's cached copy of that redirect.
export function load({ url }) {
	redirect(308, pastCachedRedirect(`/staff/incidents${url.search}`, '/staff/moderation/incidents'));
}
