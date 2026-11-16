import { redirect } from '@sveltejs/kit';
import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

// The Form 8282 filter on Acquisitions (#2767).
export function load() {
	redirect(308, pastCachedRedirect('/staff/inventory/acquisitions?show=form-8282', 'compliance'));
}
