/**
 * The staff panel's sidebar, as data.
 *
 * Pulled out of the layout template for two reasons. First, `Nav.Collapsible`
 * takes a hand-maintained `childHrefs` array, and a hand-maintained list of
 * routes drifts the moment someone adds one — `childHrefsFor` derives it from
 * the tree instead. Second, the panel had outgrown a single "Operations" group
 * that held eight unrelated rows; as data the grouping is something you can
 * read in one screen and assert against, which `nav-items.spec.ts` does.
 *
 * Nothing here is gated. `getStaffLayout` already redirects anyone without the
 * role, and the staff panel deliberately ignores feature flags so staff can
 * administer a feature before it is switched on for everyone else.
 */

import {
	activeNavKey as resolveActiveNavKey,
	childHrefsFor as resolveChildHrefs,
	flattenNav,
	type NavNode
} from '$lib/components/layout/Nav/active-nav';

export type StaffNavKey =
	| 'dashboard'
	| 'inbox'
	| 'users'
	| 'bands'
	| 'volunteer'
	| 'volunteer-shifts'
	| 'volunteer-roles'
	| 'volunteer-certifications'
	| 'volunteer-report'
	| 'reservations'
	| 'recurring'
	| 'closures'
	| 'equipment'
	| 'equipment-loans'
	| 'inventory-restock'
	| 'inventory-spend'
	| 'productions'
	| 'calendar'
	| 'flags'
	| 'suggestions'
	| 'campaigns'
	| 'audiences'
	| 'help'
	| 'payments'
	| 'credits'
	| 'settings';

export type StaffNavSectionKey =
	'people' | 'space' | 'events' | 'moderation' | 'outreach' | 'money' | 'system';

/**
 * Field names on `getStaffLayout()`'s return. Items name a count rather than
 * carrying one so the nav can stay a `const`: a badge changes a rendered
 * integer, never which rows exist, and rebuilding the array on every poll
 * would churn every `{#each}` for nothing.
 */
export type StaffNavBadgeKey =
	'inboxUnread' | 'suggestionsAwaiting' | 'volunteerPending' | 'listingsPending';

export interface StaffNavItem extends NavNode<StaffNavKey> {
	label: string;
	badgeKey?: StaffNavBadgeKey;
	/** Present ⇒ the layout renders this row as a `Nav.Collapsible`. */
	children?: StaffNavItem[];
}

export interface StaffNavSection {
	/** Stable id. The persisted collapse record keys off this, never the title. */
	key: StaffNavSectionKey;
	title: string;
	items: StaffNavItem[];
}

/** Rows above the first section header. */
export const staffNavTop: StaffNavItem[] = [
	{ key: 'dashboard', label: 'Dashboard', href: '/staff' },
	{ key: 'inbox', label: 'Inbox', href: '/staff/inbox', badgeKey: 'inboxUnread' }
];

export const staffNavSections: StaffNavSection[] = [
	{
		key: 'people',
		title: 'People',
		items: [
			{ key: 'users', label: 'Users', href: '/staff/users' },
			{ key: 'bands', label: 'Bands', href: '/staff/bands' },
			{
				key: 'volunteer',
				label: 'Volunteering',
				href: '/staff/volunteer',
				badgeKey: 'volunteerPending',
				children: [
					{ key: 'volunteer-shifts', label: 'Shifts', href: '/staff/volunteer/shifts' },
					{ key: 'volunteer-roles', label: 'Roles', href: '/staff/volunteer/roles' },
					{
						key: 'volunteer-certifications',
						label: 'Certifications',
						href: '/staff/volunteer/certifications'
					},
					{ key: 'volunteer-report', label: 'Report', href: '/staff/volunteer/report' }
				]
			}
		]
	},
	{
		key: 'space',
		title: 'Space',
		items: [
			{
				key: 'reservations',
				label: 'Reservations',
				href: '/staff/reservations',
				children: [
					{ key: 'recurring', label: 'Recurring', href: '/staff/recurring' },
					{ key: 'closures', label: 'Closures', href: '/staff/closures' }
				]
			},
			{
				// Equipment used to hang the other way up: the parent row landed on
				// Loans and the child was labelled Inventory, which the loans page
				// itself contradicts — it declares `backHref="/staff/inventory"`.
				//
				// "Inventory" rather than "Equipment" since #286: the section now
				// covers consumables too, and calling it Equipment would send anyone
				// looking for the drumstick count somewhere else.
				key: 'equipment',
				label: 'Inventory',
				href: '/staff/inventory',
				children: [
					{ key: 'equipment-loans', label: 'Loans', href: '/staff/inventory/loans' },
					{ key: 'inventory-restock', label: 'Restock', href: '/staff/inventory/restock' },
					{ key: 'inventory-spend', label: 'Spend', href: '/staff/inventory/spend' }
				]
			}
		]
	},
	{
		// Keyed `events`, not `programs`: "programs" is spoken-for — it is a
		// reserved slug for the Groups module, where a program is a club or
		// committee that runs its own sessions. Those will want a home of their
		// own, and it should not have to fight this section for the name.
		key: 'events',
		title: 'Events',
		items: [
			// Two surfaces over one table, split by what staff do with a row.
			// Productions is where a show is built — CMC's own, every status,
			// drafts included. Calendar is what the public can see, across every
			// source, plus what is asking to join it. A published CMC show is on
			// both, in two roles.
			{ key: 'productions', label: 'Productions', href: '/staff/events' },
			{
				key: 'calendar',
				label: 'Calendar',
				href: '/staff/calendar',
				badgeKey: 'listingsPending'
			}
		]
	},
	{
		key: 'moderation',
		title: 'Moderation',
		items: [
			{ key: 'flags', label: 'Content Flags', href: '/staff/flags' },
			{
				key: 'suggestions',
				label: 'Suggestions',
				href: '/staff/suggestions',
				badgeKey: 'suggestionsAwaiting'
			}
		]
	},
	{
		key: 'outreach',
		title: 'Outreach',
		items: [
			{ key: 'campaigns', label: 'Campaigns', href: '/staff/marketing/campaigns' },
			{ key: 'audiences', label: 'Audiences', href: '/staff/marketing/audiences' },
			{ key: 'help', label: 'Help Articles', href: '/staff/help' }
		]
	},
	{
		key: 'money',
		title: 'Money',
		items: [
			{ key: 'payments', label: 'Payments', href: '/staff/payments' },
			{ key: 'credits', label: 'Credits', href: '/staff/credits' }
		]
	},
	{
		key: 'system',
		title: 'System',
		items: [{ key: 'settings', label: 'Settings', href: '/staff/settings' }]
	}
];

/** Every row in the panel, parents and children alike, in render order. */
export function allStaffNavItems(): StaffNavItem[] {
	return flattenNav<StaffNavKey>([
		...staffNavTop,
		...staffNavSections.flatMap((s) => s.items)
	]) as StaffNavItem[];
}

/**
 * What `Nav.Collapsible` wants: the hrefs that should hold the row open. The
 * parent counts — being on `/staff/volunteer` itself keeps its children visible.
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
	return resolveActiveNavKey<StaffNavKey>(
		[...staffNavTop, ...staffNavSections.flatMap((s) => s.items)],
		pathname
	);
}
