import { pastCachedRedirect } from '#lib/utils/permanent-redirects.js';

/** Where an old Practice space modal link now lands, or null for the list itself. */
export function oldSpaceLink(params: URLSearchParams): string | null {
	const utec = params.get('utec');
	if (utec !== null) return `/staff/building-access?utec=${encodeURIComponent(utec)}`;
	if (params.has('access')) return '/staff/building-access';
	if (params.has('recurring')) return pastCachedRedirect('/staff/recurring', 'reservations');
	return null;
}
