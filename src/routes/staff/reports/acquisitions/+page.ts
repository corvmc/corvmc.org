import { redirect } from '@sveltejs/kit';
import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

// A list on Equipment (#2767). Records stay at /staff/inventory/acquisitions/[id].
export function load({ url }) {
	redirect(308, pastCachedRedirect(`/staff/inventory/acquisitions${url.search}`, 'reports'));
}
