/**
 * The member panel's sidebar, as data.
 *
 * Two entries are feature-flagged and one is data-gated, and they used to be
 * nested `{#if}`s in the
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

import { resolve } from '$app/paths';
import { activeNavKey, type NavNode } from '$lib/components/layout/Nav/active-nav';

export type MemberNavKey =
	| 'dashboard'
	| 'messages'
	| 'reservations'
	| 'events'
	| 'events-submit'
	| 'directory'
	| 'equipment'
	| 'equipment-loans'
	| 'volunteer'
	| 'suggestions'
	| 'profile'
	| 'account'
	| 'help'
	| 'music'
	| 'membership';

/** Field names on `getMemberLayout()`'s return. */
export type MemberNavBadgeKey = 'messagesUnread';

export interface MemberNavItem extends NavNode<MemberNavKey> {
	label: string;
	badgeKey?: MemberNavBadgeKey;
	children?: MemberNavItem[];
}

export interface MemberNavInput {
	/**
	 * Whether anything in the catalogue is lendable.
	 *
	 * Not a feature flag — the equipment flag was cut in #286. This is data: the
	 * row appears once there is something to borrow, so the catalogue is never
	 * offered empty. Gear lending was arranged in person for as long as the
	 * catalogue held nothing, and the row arriving on its own is what ends that.
	 */
	hasLoanableEquipment?: boolean;
	/**
	 * Whether the music storefront is switched on. A flag, unlike the row above
	 * it: the library can be legitimately empty and still worth reaching, because
	 * it is where a buyer goes to find a download link they mislaid.
	 */
	bandAudio?: boolean;
}

/** The rows above the "My Bands" group. */
export function memberNavMain(input: MemberNavInput): MemberNavItem[] {
	const items: MemberNavItem[] = [
		{ key: 'dashboard', label: 'Dashboard', href: resolve('/member') },
		{
			key: 'messages',
			label: 'Messages',
			href: resolve('/member/messages'),
			badgeKey: 'messagesUnread'
		},
		{ key: 'reservations', label: 'Reservations', href: resolve('/member/reservations') },
		{
			key: 'events',
			label: 'Events',
			href: resolve('/member/events'),
			children: [
				{ key: 'events-submit', label: 'Add a Show', href: resolve('/member/events/submit') }
			]
		},
		{ key: 'directory', label: 'Directory', href: resolve('/member/directory') }
	];

	if (input.bandAudio) {
		items.push({ key: 'music', label: 'Releases', href: resolve('/member/music') });
	}

	// Between Directory and Volunteering: it belongs with the things you do in
	// the space, not with the bottom cluster.
	if (input.hasLoanableEquipment) {
		items.push({
			key: 'equipment',
			label: 'Equipment',
			href: resolve('/member/equipment'),
			children: [
				{ key: 'equipment-loans', label: 'My Loans', href: resolve('/member/equipment/loans') }
			]
		});
	}

	// Was gated on a `volunteering` flag. The flag is retired and the feature was
	// on in production, so the row is simply always here — this is a flag removal,
	// not an unlink.
	items.push({ key: 'volunteer', label: 'Volunteering', href: resolve('/member/volunteer') });

	// Not flag-gated: a suggestion board with no audience collects single-vote
	// posts, so there is nothing useful to dark-launch.
	items.push({ key: 'suggestions', label: 'Suggestions', href: resolve('/member/suggestions') });

	return items;
}

/** The cluster a spacer pins to the bottom of the sidebar. */
// Takes the input it no longer reads: Help was the only footer row a flag could
// add, and it is unlinked. The parameter stays so restoring that row — or adding
// any other conditional footer entry — is a one-line change rather than a
// signature change across every caller.
export function memberNavFooter(_input: MemberNavInput): MemberNavItem[] {
	const items: MemberNavItem[] = [
		{ key: 'profile', label: 'Profile', href: resolve('/member/profile') },
		{ key: 'account', label: 'Account', href: resolve('/member/account') }
	];

	// Help had a footer row gated on a `helpArticles` flag. The flag is retired and
	// the help centre is unlinked rather than launched — it was off in production,
	// so nothing a member could see has changed — and `/member/help` answers by
	// direct URL. Launching is putting this row back; see
	// docs/plans/feature-flag-retirement.md.

	items.push({ key: 'membership', label: 'Membership', href: resolve('/member/membership') });

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
