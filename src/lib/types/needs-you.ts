import type { ResolvedPathname } from '$app/types';

/**
 * What the member has to do something about, and when it stops being possible.
 *
 * Here rather than beside the service that builds it because the dashboard
 * card renders it, and a component must not import from `$lib/server` — not
 * even a type, which would put a server module on the client's import graph.
 */

export type NeedsYouKind =
	| 'reservation-unconfirmed'
	| 'volunteer-shift-soon'
	| 'volunteer-hours-unlogged'
	| 'loan-due'
	| 'membership-ending'
	| 'band-invitation'
	| 'message-request'
	| 'profile-incomplete';

export interface NeedsYouItem {
	kind: NeedsYouKind;
	/** What has to happen, in the member's words. */
	title: string;
	detail?: string;
	href: ResolvedPathname;
	label: string;
	/**
	 * When this stops being actionable. `null` is not "no rush" — it is "no
	 * clock", which is a different thing and sorts after everything dated.
	 */
	dueAt: Date | null;
	/** Tie-break at the same instant, and the order the undated ones take. */
	rank: number;
}

/** Deadlines first, soonest wins; then the ones with no clock, by rank. */
export function sortNeedsYou(items: NeedsYouItem[]): NeedsYouItem[] {
	return items.toSorted((a, b) => {
		if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime() || a.rank - b.rank;
		if (a.dueAt) return -1;
		if (b.dueAt) return 1;
		return a.rank - b.rank;
	});
}
