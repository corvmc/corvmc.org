import type { Capability } from '#lib/config.js';

/**
 * Groups is one list (#2765) whose kind filter chooses which rows, columns and
 * actions it shows. Bands are the unfiltered list, as they were its first view.
 */
export type GroupView = 'band' | 'club' | 'committee';

/** The capability each view's remotes guard on. */
export const groupViewCapability: Record<GroupView, Capability> = {
	band: 'band.read',
	club: 'group.read',
	committee: 'committee.reviewApplications'
};

export function groupView(params: Pick<URLSearchParams, 'get'>): GroupView {
	const kind = params.get('kind');
	return kind === 'club' || kind === 'committee' ? kind : 'band';
}

/** The query that picks a view on `/staff/groups`, before the view's own filters. */
export function groupViewQuery(view: GroupView): string {
	return view === 'band' ? '' : `kind=${view}`;
}

/** The list's address for a view, carrying an old URL's query along. */
export function groupViewPath(view: GroupView, search = ''): string {
	const query = [groupViewQuery(view), search.replace(/^\?/, '')].filter(Boolean).join('&');
	return query ? `/staff/groups?${query}` : '/staff/groups';
}
