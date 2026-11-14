import type { Capability } from '#lib/config.js';

/**
 * Members is one list (#2765). Its role and status filters choose which rows,
 * columns and actions it shows: volunteers and teachers each carry their own,
 * and invited people have no account yet.
 */
export type MemberView = 'all' | 'volunteer' | 'teacher' | 'invited';

/** The capability each view's remotes guard on. */
export const memberViewCapability: Record<MemberView, Capability> = {
	all: 'user.list',
	volunteer: 'volunteer.read',
	teacher: 'instructor.read',
	invited: 'user.invite'
};

export function memberView(params: Pick<URLSearchParams, 'get'>): MemberView {
	const role = params.get('role');
	if (role === 'volunteer' || role === 'teacher') return role;
	return params.get('status') === 'invited' ? 'invited' : 'all';
}

/** The query that picks a view on `/staff/members`, before the view's own filters. */
export function memberViewQuery(view: MemberView): string {
	if (view === 'all') return '';
	return view === 'invited' ? 'status=invited' : `role=${view}`;
}

/** The list's address for a view. Components build it with `resolve()` instead. */
export function memberViewPath(view: MemberView): string {
	const query = memberViewQuery(view);
	return query ? `/staff/members?${query}` : '/staff/members';
}

/**
 * An old view URL's query, moved onto the list. Each view keeps its own `status`;
 * the volunteer view's interest filter was `role` and is `interest` now.
 */
export function memberViewRedirect(view: MemberView, search: string): string {
	const pairs = [...new URLSearchParams(search)].map(([k, v]): [string, string] =>
		view === 'volunteer' && k === 'role' ? ['interest', v] : [k, v]
	);
	const kept = pairs.filter(([k]) => !(view === 'invited' && k === 'status'));
	const query = kept.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
	const path = memberViewPath(view);
	if (!query) return path;
	return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}
