import type { Crumb, NavTrail } from '$lib/components/ui/breadcrumbs';
import { activeNavPath, type NavNode } from './Nav/active-nav';

type LabelledNode = NavNode & { label: string };

/** A panel's nav as groups of rows; a titled group adds an unlinked crumb. */
export interface NavTrailGroup {
	title?: string;
	items: LabelledNode[];
}

/**
 * The breadcrumb trail a panel's nav tree implies for a URL, so pages name only
 * their own leaf and a trail cannot drift from the sidebar (#1827). A URL no row
 * claims gets an empty trail; the page's explicit parents and leaf still apply.
 */
export function navTrail(groups: NavTrailGroup[], pathname: string): NavTrail {
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	const rows = activeNavPath(
		groups.flatMap((g) => g.items),
		path
	);
	const leaf = rows.at(-1);
	if (!leaf) return { crumbs: [], here: false };
	const here = leaf.href === path;
	const crumbs: Crumb[] = rows.map((row) =>
		row.href && !(here && row === leaf)
			? { label: row.label, href: row.href }
			: { label: row.label }
	);
	const title = groups.find((g) => g.items.includes(rows[0]))?.title;
	return { crumbs: title ? [{ label: title }, ...crumbs] : crumbs, here };
}
