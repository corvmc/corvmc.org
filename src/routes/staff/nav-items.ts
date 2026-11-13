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
import { hasCapability, surfaces, type Capability, type Surface } from '#lib/config.js';
import {
	activeNavKey as resolveActiveNavKey,
	childHrefsFor as resolveChildHrefs,
	flattenNav,
	type NavNode
} from '#lib/components/layout/Nav/active-nav.js';

export type StaffNavKey =
	| 'dashboard'
	| 'inbox'
	| 'users'
	| 'groups'
	| 'music'
	| 'ballots'
	| 'volunteer-schedule'
	| 'reservations'
	| 'gear'
	| 'supplies'
	| 'projects'
	| 'venues'
	| 'calendar'
	| 'moderation'
	| 'suggestions'
	| 'classifieds'
	| 'outreach'
	| 'help'
	| 'local-resources'
	| 'payments'
	| 'contacts'
	| 'grants'
	| 'reports'
	| 'settings'
	| 'audit';

export type StaffNavSectionKey =
	| 'people'
	| 'planning'
	| 'space'
	| 'partners'
	| 'moderation'
	| 'outreach'
	| 'money'
	| 'reports'
	| 'system';

/**
 * Field names on `getStaffLayout()`'s return. Items name a count rather than
 * carrying one so the nav can stay a `const`: a badge changes a rendered
 * integer, never which rows exist, and rebuilding the array on every poll
 * would churn every `{#each}` for nothing.
 */
export type StaffNavBadgeKey = 'inboxUnread' | 'volunteerPending' | 'reviewWaiting';

export interface StaffNavItem extends NavNode<StaffNavKey> {
	label: string;
	badgeKey?: StaffNavBadgeKey;
	/**
	 * What the viewer must hold for this row to be worth showing. Omitted on
	 * rows every position can use — the dashboard, and nothing else so far.
	 */
	capability?: Capability;
	/** Further capabilities that each also show the row, for a page with per-view gates. */
	alsoFor?: readonly Capability[];
	/** A surface switched off in code drops the row for everyone (#2116). */
	surface?: Surface;
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
	// `exact`, unlike the band panel's. `/staff` is a prefix of every path here,
	// so without it an unrecognised one — `/staff/membersomething` — lit Dashboard,
	// which is the #1237 bug. The band panel keeps its fallback because a row
	// there can be hidden by role and the root is the honest answer; no staff
	// spec asserts that, and none of the eight paths #1237 sampled needed it.
	// Its badge is everything waiting on a staff decision: the review feed (#2623).
	{
		key: 'dashboard',
		label: 'Dashboard',
		href: resolve('staff'),
		exact: true,
		badgeKey: 'reviewWaiting'
	},
	{
		key: 'inbox',
		capability: 'inbox.read',
		label: 'Inbox',
		href: resolve('staff/inbox'),
		badgeKey: 'inboxUnread'
	},
	// Every source, everything the public can see plus what is asking to join
	// it. The CMC work surface over the same table is Productions on Projects.
	{
		key: 'calendar',
		capability: 'event.read',
		label: 'Events',
		href: resolve('staff/events')
	}
];

export const staffNavSections: StaffNavSection[] = [
	{
		key: 'people',
		title: 'People',
		items: [
			// Each view has its own gate; the page sends a viewer to one they hold.
			{
				key: 'users',
				capability: 'user.list',
				alsoFor: ['volunteer.read', 'instructor.read'],
				label: 'Members',
				href: resolve('staff/members')
			},
			// Bands, Clubs and Committees are its views, each with its own gate (#2086).
			// External acts stay at their address, linked from the Bands view.
			{
				key: 'groups',
				capability: 'band.read',
				alsoFor: ['group.read', 'committee.reviewApplications'],
				label: 'Groups',
				href: resolve('staff/groups'),
				also: [resolve('staff/bands/acts')]
			}
		]
	},
	{
		// What the Collective decides to do: what members asked for, what was
		// voted, and the work.
		key: 'planning',
		title: 'Planning',
		items: [
			{
				key: 'suggestions',
				capability: 'suggestion.read',
				label: 'Suggestions',
				href: resolve('staff/suggestions')
			},
			{
				key: 'ballots',
				capability: 'ballot.manage',
				surface: 'ballots',
				label: 'Ballots',
				href: resolve('staff/ballots')
			},
			// Every task, with Projects, Recurring, Productions and Templates as
			// views (#2625). The key stays `projects`, which starred rows store.
			{
				key: 'projects',
				capability: 'project.read',
				alsoFor: ['event.manage'],
				label: 'Tasks',
				href: resolve('staff/tasks')
			},
			// Volunteer shifts (#2625): signing people up and closing shifts out.
			// It keeps the rest of `/staff/volunteer` (roles, clearances) and the
			// key `volunteer-schedule`, which starred rows store.
			{
				key: 'volunteer-schedule',
				capability: 'volunteer.read',
				label: 'Volunteering',
				href: resolve('staff/volunteering'),
				also: [resolve('staff/volunteer')],
				badgeKey: 'volunteerPending'
			}
		]
	},
	{
		key: 'space',
		title: 'Space',
		items: [
			{
				// Closures sit in its list and recurring series in a modal off its
				// header (#1936); a series' own page still lights this row. Key
				// holders is a header link on its page (#2574), so it lights it too.
				key: 'reservations',
				capability: 'reservation.read',
				label: 'Practice space',
				href: resolve('staff/reservations'),
				also: [resolve('staff/recurring'), resolve('staff/keys')]
			},
			// Gear is what is tracked unit by unit or lent out; Supplies is what is
			// used up (#2573, predicate in `server/inventory/sections.ts`). Loans,
			// reported problems and compliance are Gear's tabs, at their old URLs.
			{
				key: 'gear',
				capability: 'inventory.read',
				label: 'Gear',
				href: resolve('staff/inventory')
			},
			{
				key: 'supplies',
				capability: 'inventory.read',
				label: 'Supplies',
				href: resolve('staff/inventory/supplies')
			}
		]
	},
	{
		// The organisations the Collective deals with. Contractor jobs are work,
		// so they sit beside Projects instead.
		key: 'partners',
		title: 'Partners',
		items: [
			// Every outside organization (#2622). The Sponsors and Contractors pages
			// are its records; a role's own capability opens that role's view.
			{
				key: 'contacts',
				capability: 'contact.read',
				alsoFor: ['sponsor.read', 'grant.read', 'contractor.read'],
				label: 'Contacts',
				href: resolve('staff/contacts'),
				also: [resolve('staff/sponsors'), resolve('staff/contractors')]
			},
			// Guarded as an event because that is what a venue is a fact about.
			{
				key: 'venues',
				capability: 'event.read',
				label: 'Venues',
				href: resolve('staff/venues')
			},
			{
				key: 'local-resources',
				capability: 'localResource.manage',
				label: 'Local Resources',
				href: resolve('staff/local-resources')
			}
		]
	},
	{
		// Online content and in-person conduct alike: an incident can be about a
		// member or an off-site show, not only the building.
		key: 'moderation',
		title: 'Moderation',
		items: [
			// Content Flags and Incidents are its views, each with its own gate (#2393).
			// Their records keep their addresses, which notifications link to.
			{
				key: 'moderation',
				capability: 'moderation.reviewFlags',
				alsoFor: ['incident.read'],
				label: 'Moderation',
				href: resolve('staff/moderation'),
				also: [resolve('staff/flags'), resolve('staff/incidents')]
			},
			{
				key: 'classifieds',
				capability: 'listing.review',
				surface: 'classifieds',
				label: 'Classifieds',
				href: resolve('staff/classifieds')
			}
		]
	},
	{
		key: 'outreach',
		title: 'Outreach',
		items: [
			// Campaigns and Audiences are its views, each with its own gate (#2394).
			{
				key: 'outreach',
				capability: 'marketing.read',
				alsoFor: ['marketing.manageAudiences'],
				label: 'Outreach',
				href: resolve('staff/marketing')
			}
		]
	},
	{
		key: 'money',
		title: 'Money',
		items: [
			// Payments and Credits are its views, each with its own gate (#2395).
			{
				key: 'payments',
				capability: 'finance.read',
				alsoFor: ['credit.read'],
				label: 'Payments',
				href: resolve('staff/money')
			},
			// Money rather than Moderation: the page's first job is answering
			// whether there is enough music to switch the station on, and its
			// second is the sales the collective takes a share of. The takedown
			// controls ride along because they act on the same rows.
			//
			// `music.read`: the treasurer for the sales, the site moderator for the
			// takedowns.
			{
				key: 'music',
				capability: 'music.read',
				label: 'Releases',
				href: resolve('staff/music')
			},
			{
				key: 'grants',
				capability: 'grant.read',
				label: 'Grants',
				href: resolve('staff/grants')
			}
		]
	},
	{
		// Every report in one place.
		key: 'reports',
		title: 'Reports',
		items: [
			// Each view has its own gate (#2396). An acquisition's record stays under
			// inventory, where its receipt and its items are, and lights this row.
			{
				key: 'reports',
				capability: 'finance.read',
				alsoFor: ['volunteer.report', 'inventory.report', 'inventory.manageAcquisitions'],
				label: 'Reports',
				href: resolve('staff/reports'),
				also: [resolve('staff/inventory/spend'), resolve('staff/inventory/acquisitions')]
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
				href: resolve('staff/settings')
			},
			// The app's own documentation for members and staff.
			{
				key: 'help',
				capability: 'help.read',
				label: 'Help Articles',
				href: resolve('staff/help')
			},
			{ key: 'audit', capability: 'audit.read', label: 'Audit Log', href: resolve('staff/audit') }
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
