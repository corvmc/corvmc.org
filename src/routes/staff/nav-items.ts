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
	| 'calendar'
	| 'moderation'
	| 'suggestions'
	| 'classifieds'
	| 'outreach'
	| 'content'
	| 'payments'
	| 'contacts'
	| 'funding'
	| 'reports'
	| 'settings'
	| SystemNavKey;

/** The System panel's own rows (#2763). */
export type SystemNavKey = 'organization' | 'features' | 'access' | 'audit';

/** The four systems (#2762). Reports and System sit below them, outside any section. */
export type StaffNavSectionKey = 'relationships' | 'community' | 'programs' | 'operations';

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
	// which is the #1237 bug. Its badge is everything waiting on a staff
	// decision: the review feed (#2623).
	{
		key: 'dashboard',
		label: 'Dashboard',
		href: resolve('staff'),
		exact: true,
		badgeKey: 'reviewWaiting'
	},
	// Channels is its settings view (#2763).
	{
		key: 'inbox',
		capability: 'inbox.read',
		label: 'Inbox',
		href: resolve('staff/inbox'),
		badgeKey: 'inboxUnread'
	}
];

/**
 * The four systems (#2762): who the Collective deals with, its members and
 * what they do together, what it runs for them, and the work and money behind
 * it. A new module joins one of them. Row keys predate the regrouping and stay,
 * because starred rows store them.
 */
export const staffNavSections: StaffNavSection[] = [
	{
		key: 'relationships',
		title: 'Relationships',
		items: [
			// Every outside organization (#2622). Contractors, funders and sponsors
			// are its role views and sections (#2764); a role's capability opens them.
			{
				key: 'contacts',
				capability: 'contact.read',
				alsoFor: ['sponsor.read', 'grant.read', 'contractor.read'],
				label: 'Contacts',
				href: resolve('staff/contacts'),
				also: [resolve('staff/contractors'), resolve('staff/sponsors')]
			},
			// Campaigns and Audiences are its views, each with its own gate (#2394).
			{
				key: 'outreach',
				capability: 'marketing.read',
				alsoFor: ['marketing.manageAudiences'],
				label: 'Outreach',
				href: resolve('staff/marketing')
			},
			// Grant applications and sponsorships on one list (#2622). A grant's page
			// is its record; a sponsorship opens on its sponsor's Contacts page.
			{
				key: 'funding',
				capability: 'grant.read',
				alsoFor: ['sponsor.read'],
				label: 'Funding',
				href: resolve('staff/funding'),
				also: [resolve('staff/grants')]
			}
		]
	},
	{
		key: 'community',
		title: 'Community',
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
			{
				key: 'groups',
				capability: 'band.read',
				alsoFor: ['group.read', 'committee.reviewApplications'],
				label: 'Groups',
				href: resolve('staff/groups')
			},
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
			// Flags, Incidents and Blocklist are its views, each with its own gate (#2393).
			// Their records keep their addresses, which notifications link to.
			{
				key: 'moderation',
				capability: 'moderation.reviewFlags',
				alsoFor: ['incident.read', 'user.ban'],
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
			},
			// Help articles and Local resources are its views, each with its own gate (#2765).
			{
				key: 'content',
				capability: 'help.read',
				alsoFor: ['localResource.manage'],
				label: 'Content',
				href: resolve('staff/content'),
				also: [resolve('staff/help'), resolve('staff/local-resources')]
			}
		]
	},
	{
		key: 'programs',
		title: 'Programs',
		items: [
			// Every listing, with Productions, Venues and vendor applications as views
			// (#2766). A venue's own page stays under `/staff/venues` and lights this row.
			{
				key: 'calendar',
				capability: 'event.read',
				label: 'Events',
				href: resolve('staff/events'),
				also: [resolve('staff/venues')]
			},
			{
				// Reservations (closures a type filter), Recurring series and Building
				// access are its views (#2766); a series' own page lights it too.
				key: 'reservations',
				capability: 'reservation.read',
				label: 'Practice space',
				href: resolve('staff/reservations'),
				also: [resolve('staff/recurring'), resolve('staff/building-access')]
			},
			// The radio's state and every release (#2766); its sales totals are a
			// Reports view and each release's sales are on its panel. `music.read`:
			// the treasurer for the sales, the site moderator for the takedowns.
			{
				key: 'music',
				capability: 'music.read',
				label: 'Music',
				href: resolve('staff/music')
			}
		]
	},
	{
		key: 'operations',
		title: 'Operations',
		items: [
			// Every task, with Projects as a view (#2625) and recurring work and
			// templates as its settings (#2767). The key stays `projects`, which
			// starred rows store.
			{
				key: 'projects',
				capability: 'project.read',
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
			},
			// Equipment is what is tracked unit by unit or lent out; Supplies is what
			// is used up (#2573, predicate in `server/inventory/sections.ts`). Loans,
			// problems, orders and acquisitions are Equipment's other lists (#2767).
			{
				key: 'gear',
				capability: 'inventory.read',
				label: 'Equipment',
				href: resolve('staff/inventory')
			},
			{
				key: 'supplies',
				capability: 'inventory.read',
				label: 'Supplies',
				href: resolve('staff/inventory/supplies')
			},
			// Payments and Credits are its views, each with its own gate (#2395).
			{
				key: 'payments',
				capability: 'finance.read',
				alsoFor: ['credit.read'],
				label: 'Money',
				href: resolve('staff/money')
			}
		]
	}
];

/** Rows below the last section, outside any of the four systems. */
export const staffNavBottom: StaffNavItem[] = [
	// Each view has its own gate (#2396).
	{
		key: 'reports',
		capability: 'finance.read',
		alsoFor: ['volunteer.report', 'inventory.report', 'music.read'],
		label: 'Reports',
		href: resolve('staff/reports'),
		also: [resolve('staff/inventory/spend')]
	},
	// Opens the System panel, which swaps this sidebar for its own. The key
	// stays `settings`, which starred rows store.
	{
		key: 'settings',
		capability: 'settings.read',
		alsoFor: ['user.setRole', 'audit.read'],
		label: 'System',
		href: resolve('staff/system')
	}
];

/**
 * The System panel's sidebar (#2763): only what spans modules. A module's own
 * settings live on its row, so nothing here names one.
 */
export const systemNavItems: StaffNavItem[] = [
	{
		key: 'organization',
		capability: 'settings.read',
		label: 'Organization',
		href: resolve('staff/system/organization')
	},
	{
		key: 'features',
		capability: 'settings.read',
		label: 'Features',
		href: resolve('staff/system/features')
	},
	{
		key: 'access',
		capability: 'user.setRole',
		label: 'Access',
		href: resolve('staff/system/access')
	},
	{
		key: 'audit',
		capability: 'audit.read',
		label: 'Audit log',
		href: resolve('staff/system/audit')
	}
];

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
