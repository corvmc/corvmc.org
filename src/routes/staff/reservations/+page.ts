import { redirect } from '@sveltejs/kit';
import { oldSpaceLink } from './views-redirect';

/**
 * `?access`, `?utec=` and `?recurring` opened modals on this list; they are
 * Practice space views now (#2766). Stored notification links still carry them.
 */
export function load({ url }) {
	const target = oldSpaceLink(url.searchParams);
	if (target) redirect(308, target);
}
