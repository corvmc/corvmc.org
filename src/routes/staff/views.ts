import type { ResolvedPathname } from '$app/types';
import { hasCapability, type Capability } from '#lib/config.js';

/** One tab of a staff row's page. The label is a function: a catalog read needs a request. */
export interface StaffView<K extends string = string> {
	key: K;
	label: () => string;
	href: ResolvedPathname;
	cap: Capability;
}

/** Presentation only: each view's remotes refuse a viewer this hides the tab from. */
export function visibleViews<V extends StaffView>(views: readonly V[], held: readonly string[]) {
	return views.filter((v) => hasCapability(held, v.cap));
}
