/**
 * The member panel's sidebar, as data.
 *
 * One entry is data-gated, and the gating used to be a nested `{#if}` in the
 * layout. That is the exact shape `band/[slug]/nav-items.ts` was extracted to
 * escape — its header records the gating being silently wrong twice, because a
 * condition buried in markup is invisible until someone reports a missing link.
 * As a list it can be asserted against, which `nav-items.spec.ts` does.
 *
 * The panel has three zones. The sidebar renders two of them: the things you do
 * in the space, then a pair of meta rows (suggestions, help) that a spacer
 * pushes to the foot — feedback about the collective and how to use the site
 * are both *about* the thing rather than *in* it.
 *
 * The third zone is not in the sidebar at all. Messages and the four
 * member-context destinations moved into the app chrome, which mounts on every
 * authenticated page, so a band admin can reach their own inbox without
 * switching panels first (#1244). They stay in this file's key union and in
 * `memberNavItems` because they are still member routes that have to resolve to
 * something — `nav-items.spec.ts` asserts every `/member/**` page lights a key,
 * and dropping them would strand five pages on Dashboard.
 */

import { resolve } from '$app/paths';
import { activeNavKey, type NavNode } from '$lib/components/layout/Nav/active-nav';
import {
	ACCOUNT_MENU,
	MESSAGES_HREF,
	type AccountMenuKey
} from '$lib/components/layout/account-menu';

export type MemberNavKey =
	| 'dashboard'
	| 'messages'
	| 'reservations'
	| 'events'
	| 'events-submit'
	| 'directory'
	| 'classifieds'
	| 'equipment'
	| 'equipment-loans'
	| 'volunteer'
	| 'volunteer-committees'
	| 'suggestions'
	| 'ballots'
	| 'profile'
	| 'account'
	| 'help'
	| 'purchases'
	| 'membership';

/**
 * The keys the sidebar actually draws. The rest of `MemberNavKey` is chrome —
 * still a member destination, still resolved by `activeMemberNavKey`, but drawn
 * by `AppTopbar` and `AccountDropdown`, which own their own glyphs.
 */
export type SidebarNavKey = Exclude<MemberNavKey, 'messages' | AccountMenuKey>;

export interface MemberNavItem extends NavNode<MemberNavKey> {
	label: string;
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
}

/** The rows above the "My Bands" group. */
export function memberNavMain(input: MemberNavInput): MemberNavItem[] {
	const items: MemberNavItem[] = [
		{ key: 'dashboard', label: 'Dashboard', href: resolve('/member'), exact: true },
		{ key: 'reservations', label: 'Reservations', href: resolve('/member/reservations') },
		{
			key: 'events',
			label: 'Events',
			href: resolve('/member/events'),
			children: [
				{ key: 'events-submit', label: 'Add a Show', href: resolve('/member/events/submit') }
			]
		},
		{ key: 'directory', label: 'Directory', href: resolve('/member/directory') },
		{ key: 'classifieds', label: 'Classifieds', href: resolve('/member/classifieds') }
	];

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
	// Committees sit under Volunteering because that is where /contribute puts
	// them and because "how do I get more involved" is one question to a member.
	// They are not volunteering in the model — a committee is governance and a
	// `volunteer_role` grants nothing — but a second top-level row for something
	// most people use once would be the wrong trade.
	items.push({
		key: 'volunteer',
		label: 'Volunteering',
		href: resolve('/member/volunteer'),
		children: [
			{
				key: 'volunteer-committees',
				label: 'Committees',
				href: resolve('/member/volunteer/committees')
			}
		]
	});

	return items;
}

/**
 * The two meta rows a spacer pins to the foot of the sidebar.
 *
 * Neither is flag-gated. A suggestion board with no audience collects
 * single-vote posts, so there is nothing useful to dark-launch; and the help
 * centre has nothing to gate on — the articles ship in the repo, and the row
 * being left out when the `helpArticles` flag went left 75 of them reachable
 * only by typing the URL.
 */
// Takes the input none of its rows read. The parameter stays so adding a
// conditional footer entry is a one-line change rather than a signature change
// across every caller.
export function memberNavFooter(_input: MemberNavInput): MemberNavItem[] {
	return [
		{ key: 'suggestions', label: 'Suggestions', href: resolve('/member/suggestions') },
		{ key: 'ballots', label: 'Ballots', href: resolve('/member/ballots') },
		{ key: 'help', label: 'Help', href: resolve('/member/help') }
	];
}

/**
 * Destinations the app chrome owns — the topbar's messages icon and the avatar
 * dropdown. Never rendered in the sidebar; here so they still resolve.
 */
export function memberNavChrome(): MemberNavItem[] {
	return [
		{ key: 'messages', label: 'Messages', href: MESSAGES_HREF },
		...ACCOUNT_MENU.map((item) => ({ key: item.key, label: item.label, href: item.href }))
	];
}

/** Every member destination, sidebar and chrome alike. Not a render list. */
export function memberNavItems(input: MemberNavInput): MemberNavItem[] {
	return [...memberNavMain(input), ...memberNavFooter(input), ...memberNavChrome()];
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
