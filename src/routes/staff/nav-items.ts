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

import { resolve } from '$app/paths';
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
	| 'groups'
	| 'volunteer'
	| 'volunteer-schedule'
	| 'volunteer-hours'
	| 'volunteer-people'
	| 'volunteer-roles'
	| 'volunteer-certifications'
	| 'volunteer-report'
	| 'reservations'
	| 'recurring'
	| 'closures'
	| 'instructors'
	| 'equipment'
	| 'equipment-loans'
	| 'inventory-intake'
	| 'inventory-tagging'
	| 'inventory-acquisitions'
	| 'inventory-restock'
	| 'inventory-orders'
	| 'inventory-spend'
	| 'inventory-compliance'
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
	{ key: 'dashboard', label: 'Dashboard', href: resolve('/staff') },
	{ key: 'inbox', label: 'Inbox', href: resolve('/staff/inbox'), badgeKey: 'inboxUnread' }
];

export const staffNavSections: StaffNavSection[] = [
	{
		key: 'people',
		title: 'People',
		items: [
			{ key: 'users', label: 'Users', href: resolve('/staff/users') },
			{ key: 'bands', label: 'Bands', href: resolve('/staff/bands') },
			// Clubs and committees, separate from Bands on purpose: a band is a
			// member's own project and a program is a sanctioned CMC one, and this
			// is the only place a program comes into existence.
			{ key: 'groups', label: 'Groups', href: resolve('/staff/groups') },
			{
				// The parent row is a dashboard, not an index — see
				// docs/development/ui-patterns.md#section-dashboards. It keeps its own href
				// because `Nav.Collapsible` treats the parent as clickable and holds the
				// children open while you are on it, so the worklist is one click from
				// anywhere and each table is one click from the worklist.
				key: 'volunteer',
				label: 'Volunteering',
				href: resolve('/staff/volunteer'),
				badgeKey: 'volunteerPending',
				children: [
					{
						key: 'volunteer-schedule',
						label: 'Schedule',
						href: resolve('/staff/volunteer/schedule')
					},
					{ key: 'volunteer-hours', label: 'Hours', href: resolve('/staff/volunteer/hours') },
					{
						key: 'volunteer-people',
						label: 'Volunteers',
						href: resolve('/staff/volunteer/people')
					},
					{ key: 'volunteer-roles', label: 'Roles', href: resolve('/staff/volunteer/roles') },
					{
						key: 'volunteer-certifications',
						label: 'Certifications',
						href: resolve('/staff/volunteer/certifications')
					},
					{ key: 'volunteer-report', label: 'Report', href: resolve('/staff/volunteer/report') }
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
				href: resolve('/staff/reservations'),
				children: [
					{ key: 'recurring', label: 'Recurring', href: resolve('/staff/recurring') },
					{ key: 'closures', label: 'Closures', href: resolve('/staff/closures') },
					// Under Reservations rather than beside Users: teaching status is a
					// right in the room, and what it grants is a rate and a booking
					// window. Everything about the room is one place.
					{ key: 'instructors', label: 'Instructors', href: resolve('/staff/instructors') }
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
				href: resolve('/staff/inventory'),
				children: [
					{ key: 'inventory-intake', label: 'Intake', href: resolve('/staff/inventory/intake') },
					{
						key: 'inventory-tagging',
						label: 'Needs tagging',
						href: resolve('/staff/inventory/tagging')
					},
					{ key: 'equipment-loans', label: 'Loans', href: resolve('/staff/inventory/loans') },
					{
						key: 'inventory-acquisitions',
						label: 'Acquisitions',
						href: resolve('/staff/inventory/acquisitions')
					},
					{ key: 'inventory-restock', label: 'Restock', href: resolve('/staff/inventory/restock') },
					{ key: 'inventory-orders', label: 'Orders', href: resolve('/staff/inventory/orders') },
					{ key: 'inventory-spend', label: 'Spend', href: resolve('/staff/inventory/spend') },
					{
						key: 'inventory-compliance',
						label: 'Compliance',
						href: resolve('/staff/inventory/compliance')
					}
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
			// Two surfaces over one table, split by what staff do with a row, and
			// the URLs say which is the general case. The Calendar — every source,
			// everything the public can see plus what is asking to join it — holds
			// `/staff/events`, the address every event ref resolves to, so a
			// staffer arriving from a shift or a notification lands on the view
			// that is safe for anyone with staff access. Productions is the CMC
			// work surface and sits at its own path, ready to be gated.
			{
				key: 'calendar',
				label: 'Calendar',
				href: resolve('/staff/events'),
				badgeKey: 'listingsPending'
			},
			{ key: 'productions', label: 'Productions', href: resolve('/staff/productions') }
		]
	},
	{
		key: 'moderation',
		title: 'Moderation',
		items: [
			{ key: 'flags', label: 'Content Flags', href: resolve('/staff/flags') },
			{
				key: 'suggestions',
				label: 'Suggestions',
				href: resolve('/staff/suggestions'),
				badgeKey: 'suggestionsAwaiting'
			}
		]
	},
	{
		key: 'outreach',
		title: 'Outreach',
		items: [
			{ key: 'campaigns', label: 'Campaigns', href: resolve('/staff/marketing/campaigns') },
			{ key: 'audiences', label: 'Audiences', href: resolve('/staff/marketing/audiences') },
			{ key: 'help', label: 'Help Articles', href: resolve('/staff/help') }
		]
	},
	{
		key: 'money',
		title: 'Money',
		items: [
			{ key: 'payments', label: 'Payments', href: resolve('/staff/payments') },
			{ key: 'credits', label: 'Credits', href: resolve('/staff/credits') }
		]
	},
	{
		key: 'system',
		title: 'System',
		items: [{ key: 'settings', label: 'Settings', href: resolve('/staff/settings') }]
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
