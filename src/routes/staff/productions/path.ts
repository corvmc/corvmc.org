import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

/**
 * Where an old Productions address lands (#3112). The old view's `production`
 * filter is the list's `status`, and `needs` carries over; its listing status,
 * venue and dates have no column here. `/staff/productions` once 308'd away,
 * so the target carries `via` past a browser's cached copy.
 */
export function productionsPath(search: string, source: string): string {
	const old = new URLSearchParams(search);
	const next = new URLSearchParams();
	const status = old.get('production');
	if (status) next.set('status', status);
	if (old.get('needs') === '1') next.set('needs', '1');
	const query = next.toString();
	return pastCachedRedirect(`/staff/productions${query ? `?${query}` : ''}`, source);
}
