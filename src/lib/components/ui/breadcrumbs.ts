import { getContext, setContext } from 'svelte';
import type { ResolvedPathname } from '$app/types';

/** One step of a trail. No `href` renders plain text: a nav group, or the page itself. */
export interface Crumb {
	label: string;
	href?: ResolvedPathname;
}

/**
 * The part of a trail a panel layout knows from its nav tree. `here` means the
 * URL is the active row itself, so the last crumb already names the page and a
 * page's own leaf is not appended.
 */
export interface NavTrail {
	crumbs: Crumb[];
	here: boolean;
}

const KEY = Symbol('breadcrumb-trail');

/** Called by a panel layout, before any `await`, with a getter that tracks the URL. */
export function setBreadcrumbTrail(trail: { readonly current: NavTrail }): void {
	setContext(KEY, trail);
}

/** Undefined outside a panel — a public page has no nav tree to derive from. */
export function getBreadcrumbTrail(): { readonly current: NavTrail } | undefined {
	return getContext(KEY);
}

/**
 * A page's full trail: the nav part, then any parents the URL cannot say, then
 * the page. A parent the nav already supplied is dropped, so naming one is safe
 * even where the row is sometimes present. Returns nothing unless some crumb
 * links somewhere, since a trail with no way up is only a second title.
 */
export function pageCrumbs(trail: NavTrail | undefined, parents: Crumb[], leaf: string): Crumb[] {
	const nav = trail?.crumbs ?? [];
	const crumbs = trail?.here
		? nav
		: [
				...nav,
				...parents.filter((p) => !p.href || !nav.some((n) => n.href === p.href)),
				{ label: leaf }
			];
	return crumbs.some((c) => c.href) ? crumbs : [];
}
