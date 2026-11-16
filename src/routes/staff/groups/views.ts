import type { GroupKind } from '#lib/config.js';
import { pastCachedKey, pastCachedRedirect } from '#lib/utils/permanent-redirects.js';
import { staffGroupHref, staffGroupListHref } from '#lib/utils/group-href.js';

/** The kind an old `/staff/groups` address named. Bands were its unfiltered list. */
export function groupView(params: Pick<URLSearchParams, 'get'>): GroupKind {
	const kind = params.get('kind');
	return kind === 'club' || kind === 'committee' ? kind : 'band';
}

/** An old address's query, less what only the combined list read. */
function carried(search: string): string {
	const params = new URLSearchParams(search);
	params.delete('kind');
	params.delete(pastCachedKey);
	const query = params.toString();
	return query ? `?${query}` : '';
}

/**
 * Where an old Groups address lands. Each kind's list and record once 308'd to
 * `/staff/groups`, so a browser holding that 308 loops without `via` (#2961).
 */
export function groupListRedirect(kind: GroupKind, search: string): string {
	return pastCachedRedirect(`${staffGroupListHref(kind)}${carried(search)}`, 'groups');
}

export function groupRecordRedirect(kind: GroupKind, id: string, search: string): string {
	return pastCachedRedirect(`${staffGroupHref(kind, id)}${carried(search)}`, 'groups');
}
