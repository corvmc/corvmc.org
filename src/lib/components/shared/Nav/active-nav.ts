/**
 * Which sidebar row to light up for a pathname, shared by all three panels.
 *
 * `NavItem` decides on its own by exact pathname equality, which means every
 * detail page in the app lit no row at all: `/staff/users/abc` matched nothing,
 * and so did `/member/reservations/abc/pay` and `/band/x/events/abc`. Panels
 * pass the result of this in as `active` instead.
 *
 * Longest match wins, so a panel root never out-competes the section it
 * contains and a nested row beats its parent, with no dependence on the order
 * items are declared in.
 */

export interface NavNode<K extends string = string> {
	key: K;
	href: string;
	children?: NavNode<K>[];
}

/** Parents and children in one list, in render order. */
export function flattenNav<K extends string>(items: NavNode<K>[]): NavNode<K>[] {
	const flat: NavNode<K>[] = [];
	const walk = (nodes: NavNode<K>[]) => {
		for (const node of nodes) {
			flat.push(node);
			if (node.children) walk(node.children);
		}
	};
	walk(items);
	return flat;
}

/**
 * The hrefs that should hold a collapsible row open. The parent counts — being
 * on `/staff/volunteer` itself keeps its children visible.
 */
export function childHrefsFor<K extends string>(item: NavNode<K>): string[] {
	return [item.href, ...(item.children ?? []).map((c) => c.href)];
}

/**
 * Segment-aligned rather than a bare prefix: `startsWith('/member/events')`
 * alone would let the Events row claim a would-be `/member/eventsomething`.
 *
 * Rows with an empty or off-site href sit this out — a band's "View Live Site"
 * points at another origin and can never be the active row.
 */
export function activeNavKey<K extends string>(items: NavNode<K>[], pathname: string): K | null {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	let best: K | null = null;
	let bestLength = -1;
	for (const item of flattenNav(items)) {
		if (!item.href.startsWith('/')) continue;
		if (path !== item.href && !path.startsWith(item.href + '/')) continue;
		if (item.href.length > bestLength) {
			bestLength = item.href.length;
			best = item.key;
		}
	}
	return best;
}
