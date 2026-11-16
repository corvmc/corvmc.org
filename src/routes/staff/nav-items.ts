/**
 * The staff panel's sidebar, as data.
 *
 * As data, `childHrefsFor` derives what `Nav.Collapsible` would otherwise take
 * as a hand-maintained list of routes, and the grouping into the four systems
 * can be read in one screen and asserted, which `nav-items.spec.ts` does.
 *
 * Rows carry a `capability`. `getStaffLayout` still redirects anyone holding no
 * position at all, but "may open the panel" and "may use this row" stopped being
 * the same question once guards began naming capabilities — a treasurer offered
 * a Volunteering row lands on a 403. `filterNav` below drops what the viewer
 * cannot use.
 *
 * Hiding a row is not a guard. The guard is `requireCapability` on the remote
 * function behind it; this only stops someone walking into a 403.
 *
 * The panel still deliberately ignores feature flags, so staff can administer a
 * feature before it is switched on for everyone else.
 */

import { resolve } from '$app/paths';
import { hasCapability, surfaces } from '#lib/config.js';
import {
	activeNavKey as resolveActiveNavKey,
	childHrefsFor as resolveChildHrefs,
	flattenNav
} from '#lib/components/layout/Nav/active-nav.js';
import type { StaffNavItem, StaffNavKey, StaffNavSection } from './nav-items/types';
import { staffNavTop } from './nav-items/top';
import { relationships } from './nav-items/relationships';
import { community } from './nav-items/community';
import { programs } from './nav-items/programs';
import { operations } from './nav-items/operations';
import { staffNavBottom } from './nav-items/bottom';
import { systemNavItems } from './nav-items/system';

export type {
	StaffNavBadgeKey,
	StaffNavItem,
	StaffNavKey,
	StaffNavSection,
	StaffNavSectionKey
} from './nav-items/types';
export type { SystemNavKey } from './nav-items/system';
export { staffNavTop, staffNavBottom, systemNavItems };

/**
 * The four systems (#2762): who the Collective deals with, its members and
 * what they do together, what it runs for them, and the work and money behind
 * it. A new module joins one of them, in its file under `nav-items/`. Row keys
 * predate the regrouping and stay, because starred rows store them.
 */
export const staffNavSections: StaffNavSection[] = [relationships, community, programs, operations];

/** Whether a path is in the System panel, which has its own sidebar. */
export function inSystemPanel(pathname: string): boolean {
	const root = resolve('staff/system');
	return pathname === root || pathname.startsWith(root + '/');
}

/** Which System row to light for a pathname. */
export function activeSystemKey(pathname: string): StaffNavKey | null {
	return resolveActiveNavKey<StaffNavKey>(systemNavItems, pathname);
}

/** Every row in the panel, parents and children alike, in render order. */
export function allStaffNavItems(): StaffNavItem[] {
	return flattenNav<StaffNavKey>(mainNav()) as StaffNavItem[];
}

/**
 * What `Nav.Collapsible` wants: the hrefs that should hold the row open. The
 * parent counts — being on a parent's own page keeps its children visible.
 */
export function childHrefsFor(item: StaffNavItem): string[] {
	return resolveChildHrefs(item);
}

export function sectionHasKey(section: StaffNavSection, key: StaffNavKey | null): boolean {
	if (!key) return false;
	return section.items.some((i) => i.key === key || i.children?.some((c) => c.key === key));
}

/** Which single row to light up for a pathname. See `active-nav.ts`. */
export function activeNavKey(pathname: string): StaffNavKey | null {
	return resolveActiveNavKey<StaffNavKey>(mainNav(), pathname);
}

function mainNav(): StaffNavItem[] {
	return [...staffNavTop, ...staffNavSections.flatMap((s) => s.items), ...staffNavBottom];
}

/**
 * The nav the viewer can actually use.
 *
 * A row survives when the viewer holds its `capability`, or when it names none.
 * A parent whose own capability passes keeps only the children that also pass —
 * and a parent with no surviving children is dropped, because a Collapsible
 * that opens onto nothing reads as a broken row rather than an empty one.
 *
 * Sections empty themselves out the same way and disappear with their last row.
 *
 * This is presentation, not authorization: the guard is `requireCapability` on
 * the remote function behind each page. Filtering only stops someone being
 * offered a link that would 403.
 */
export function filterNavItems(items: StaffNavItem[], held: readonly string[]): StaffNavItem[] {
	return items.flatMap((item) => {
		if (item.surface && !surfaces[item.surface]) return [];
		const allowed = [item.capability, ...(item.alsoFor ?? [])].filter((c) => c !== undefined);
		if (allowed.length > 0 && !allowed.some((c) => hasCapability(held, c))) return [];
		if (!item.children) return [item];
		const children = filterNavItems(item.children, held);
		return children.length > 0 ? [{ ...item, children }] : [];
	});
}

export function filterNavSections(
	sections: StaffNavSection[],
	held: readonly string[]
): StaffNavSection[] {
	return sections
		.map((section) => ({ ...section, items: filterNavItems(section.items, held) }))
		.filter((section) => section.items.length > 0);
}
