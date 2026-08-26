/**
 * The member panel's sidebar, as data.
 *
 * Two entries are feature-flagged, and they used to be nested `{#if}`s in the
 * layout. That is the exact shape `band/[slug]/nav-items.ts` was extracted to
 * escape — its header records the gating being silently wrong twice, because a
 * condition buried in markup is invisible until someone reports a missing link.
 * As a list it can be asserted against, which `nav-items.spec.ts` does for
 * every flag combination.
 *
 * The panel has two zones rather than staff's seven groups: the things you do,
 * then a bottom cluster (profile, account, help, membership) that a spacer
 * pushes to the foot of the sidebar. Twelve rows do not need regrouping.
 */

import { activeNavKey, type NavNode } from '$lib/components/layout/Nav/active-nav';

export type MemberNavKey =
	| 'dashboard'
	| 'messages'
	| 'reservations'
	| 'events'
	| 'events-submit'
	| 'directory'
	| 'volunteer'
	| 'suggestions'
	| 'profile'
	| 'account'
	| 'help'
	| 'membership';

/** Field names on `getMemberLayout()`'s return. */
export type MemberNavBadgeKey = 'messagesUnread';

export interface MemberNavItem extends NavNode<MemberNavKey> {
	label: string;
	badgeKey?: MemberNavBadgeKey;
	children?: MemberNavItem[];
}

export interface MemberNavInput {
	features: { volunteering?: boolean; helpArticles?: boolean };
}

/** The rows above the "My Bands" group. */
export function memberNavMain(input: MemberNavInput): MemberNavItem[] {
	const items: MemberNavItem[] = [
		{ key: 'dashboard', label: 'Dashboard', href: '/member' },
		{ key: 'messages', label: 'Messages', href: '/member/messages', badgeKey: 'messagesUnread' },
		{ key: 'reservations', label: 'Reservations', href: '/member/reservations' },
		{
			key: 'events',
			label: 'Events',
			href: '/member/events',
			children: [{ key: 'events-submit', label: 'Add a Show', href: '/member/events/submit' }]
		},
		{ key: 'directory', label: 'Directory', href: '/member/directory' }
	];

	if (input.features.volunteering) {
		items.push({ key: 'volunteer', label: 'Volunteering', href: '/member/volunteer' });
	}

	// Not flag-gated: a suggestion board with no audience collects single-vote
	// posts, so there is nothing useful to dark-launch.
	items.push({ key: 'suggestions', label: 'Suggestions', href: '/member/suggestions' });

	return items;
}

/** The cluster a spacer pins to the bottom of the sidebar. */
export function memberNavFooter(input: MemberNavInput): MemberNavItem[] {
	const items: MemberNavItem[] = [
		{ key: 'profile', label: 'Profile', href: '/member/profile' },
		{ key: 'account', label: 'Account', href: '/member/account' }
	];

	if (input.features.helpArticles) {
		items.push({ key: 'help', label: 'Help', href: '/member/help' });
	}

	items.push({ key: 'membership', label: 'Membership', href: '/member/membership' });

	return items;
}

export function memberNavItems(input: MemberNavInput): MemberNavItem[] {
	return [...memberNavMain(input), ...memberNavFooter(input)];
}

/**
 * Which row to light up. Every member detail page — a thread, a reservation's
 * payment step, a directory profile, the volunteering onboarding steps — lit
 * nothing before this, because `NavItem` matches the pathname exactly.
 *
 * The band rows in "My Bands" are deliberately not part of this: they leave the
 * panel for `/band/<slug>`, so no member row should light on them.
 */
export function activeMemberNavKey(input: MemberNavInput, pathname: string): MemberNavKey | null {
	return activeNavKey(memberNavItems(input), pathname);
}
