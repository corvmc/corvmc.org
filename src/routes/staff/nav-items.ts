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
import { hasCapability, type Capability } from '$lib/config';
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
	| 'volunteer-people'
	| 'volunteer-setup'
	| 'volunteer-duty-lists'
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
	| 'contractors'
	| 'contractor-jobs'
	| 'projects'
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
	/**
	 * What the viewer must hold for this row to be worth showing. Omitted on
	 * rows every position can use — the dashboard, and nothing else so far.
	 */
	capability?: Capability;
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
	{
		key: 'inbox',
		capability: 'inbox.read',
		label: 'Inbox',
		href: resolve('/staff/inbox'),
		badgeKey: 'inboxUnread'
	}
];

export const staffNavSections: StaffNavSection[] = [
	{
		key: 'people',
		title: 'People',
		items: [
			{ key: 'users', capability: 'user.list', label: 'Users', href: resolve('/staff/users') },
			{ key: 'bands', capability: 'band.read', label: 'Bands', href: resolve('/staff/bands') },
			// Clubs and committees, separate from Bands on purpose: a band is a
			// member's own project and a program is a sanctioned CMC one, and this
			// is the only place a program comes into existence.
			{ key: 'groups', capability: 'group.read', label: 'Groups', href: resolve('/staff/groups') },
			{
				// The parent row is a dashboard, not an index — see
				// docs/development/ui-patterns.md#section-dashboards. It keeps its own href
				// because `Nav.Collapsible` treats the parent as clickable and holds the
				// children open while you are on it, so the worklist is one click from
				// anywhere and each table is one click from the worklist.
				key: 'volunteer',
				capability: 'volunteer.read',
				label: 'Volunteering',
				href: resolve('/staff/volunteer'),
				badgeKey: 'volunteerPending',
				children: [
					{
						key: 'volunteer-schedule',
						capability: 'volunteer.manageShifts',
						label: 'Schedule',
						href: resolve('/staff/volunteer/schedule')
					},
					{
						// "People", not "Volunteers": it holds the under-18 queue and the
						// clearances table too, and both are about people who are not yet
						// volunteering.
						key: 'volunteer-people',
						capability: 'volunteer.read',
						label: 'People',
						href: resolve('/staff/volunteer/people')
					},
					{
						key: 'volunteer-setup',
						capability: 'volunteer.manageRoles',
						label: 'Setup',
						href: resolve('/staff/volunteer/setup')
					},
					// Its own row rather than folded into Setup. A duty list is arguably
					// a definition like a role is, but it landed on `main` as a screen of
					// its own while this branch was in flight, and quietly absorbing
					// somebody else's new surface into a redesign they did not review is
					// not a merge resolution.
					{
						key: 'volunteer-duty-lists',
						capability: 'event.read',
						label: 'Duty Lists',
						href: resolve('/staff/volunteer/duty-lists')
					},
					{
						key: 'volunteer-report',
						capability: 'volunteer.report',
						label: 'Report',
						href: resolve('/staff/volunteer/report')
					}
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
				capability: 'reservation.read',
				label: 'Reservations',
				href: resolve('/staff/reservations'),
				children: [
					{
						key: 'recurring',
						capability: 'reservation.read',
						label: 'Recurring',
						href: resolve('/staff/recurring')
					},
					{
						key: 'closures',
						capability: 'reservation.manageClosures',
						label: 'Closures',
						href: resolve('/staff/closures')
					},
					// Under Reservations rather than beside Users: teaching status is a
					// right in the room, and what it grants is a rate and a booking
					// window. Everything about the room is one place.
					{
						key: 'instructors',
						capability: 'instructor.read',
						label: 'Instructors',
						href: resolve('/staff/instructors')
					}
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
				capability: 'inventory.read',
				label: 'Inventory',
				href: resolve('/staff/inventory'),
				children: [
					{
						key: 'inventory-intake',
						capability: 'inventory.manageStock',
						label: 'Intake',
						href: resolve('/staff/inventory/intake')
					},
					{
						key: 'inventory-tagging',
						capability: 'inventory.manageAssets',
						label: 'Needs tagging',
						href: resolve('/staff/inventory/tagging')
					},
					{
						key: 'equipment-loans',
						capability: 'inventory.manageLoans',
						label: 'Loans',
						href: resolve('/staff/inventory/loans')
					},
					{
						key: 'inventory-acquisitions',
						capability: 'inventory.manageAcquisitions',
						label: 'Acquisitions',
						href: resolve('/staff/inventory/acquisitions')
					},
					{
						key: 'inventory-restock',
						capability: 'inventory.report',
						label: 'Restock',
						href: resolve('/staff/inventory/restock')
					},
					{
						key: 'inventory-orders',
						capability: 'inventory.manageOrders',
						label: 'Orders',
						href: resolve('/staff/inventory/orders')
					},
					{
						key: 'inventory-spend',
						capability: 'inventory.report',
						label: 'Spend',
						href: resolve('/staff/inventory/spend')
					},
					{
						key: 'inventory-compliance',
						capability: 'inventory.manageAcquisitions',
						label: 'Compliance',
						href: resolve('/staff/inventory/compliance')
					}
				]
			},
			{
				// A sibling of Inventory rather than a child of it. Half of what a
				// contractor does is to the building, which owns no inventory row —
				// filing the electrician under the gear catalog would make the
				// building half unfindable.
				key: 'contractors',
				capability: 'contractor.read',
				label: 'Contractors',
				href: resolve('/staff/contractors'),
				children: [
					{
						key: 'contractor-jobs',
						capability: 'contractor.read',
						label: 'Jobs',
						href: resolve('/staff/contractors/jobs')
					}
				]
			},
			{
				// Beside Contractors rather than under Events: a project is as
				// often a facility improvement with no event at all as it is a
				// festival, and filing it under the calendar would hide the half
				// this table exists for.
				key: 'projects',
				capability: 'project.read',
				label: 'Projects',
				href: resolve('/staff/projects')
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
				capability: 'event.read',
				label: 'Calendar',
				href: resolve('/staff/events'),
				badgeKey: 'listingsPending'
			},
			{
				key: 'productions',
				capability: 'event.manage',
				label: 'Productions',
				href: resolve('/staff/productions')
			}
		]
	},
	{
		key: 'moderation',
		title: 'Moderation',
		items: [
			{
				key: 'flags',
				capability: 'moderation.reviewFlags',
				label: 'Content Flags',
				href: resolve('/staff/flags')
			},
			{
				key: 'suggestions',
				capability: 'suggestion.read',
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
			{
				key: 'campaigns',
				capability: 'marketing.read',
				label: 'Campaigns',
				href: resolve('/staff/marketing/campaigns')
			},
			{
				key: 'audiences',
				capability: 'marketing.manageAudiences',
				label: 'Audiences',
				href: resolve('/staff/marketing/audiences')
			},
			{ key: 'help', capability: 'help.read', label: 'Help Articles', href: resolve('/staff/help') }
		]
	},
	{
		key: 'money',
		title: 'Money',
		items: [
			{
				key: 'payments',
				capability: 'finance.read',
				label: 'Payments',
				href: resolve('/staff/payments')
			},
			{
				key: 'credits',
				capability: 'credit.read',
				label: 'Credits',
				href: resolve('/staff/credits')
			}
		]
	},
	{
		key: 'system',
		title: 'System',
		items: [
			{
				key: 'settings',
				capability: 'settings.read',
				label: 'Settings',
				href: resolve('/staff/settings')
			}
		]
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
		if (item.capability && !hasCapability(held, item.capability)) return [];
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
