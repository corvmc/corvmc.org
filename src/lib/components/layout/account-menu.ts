import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import { activeNavKey, type NavNode } from './Nav/active-nav';

/**
 * The member-context destinations, which live in the avatar dropdown rather
 * than in any panel's sidebar.
 *
 * "Member-context" is strictly self-context: your identity, your settings, your
 * receipts, your subscription. The Directory is not here even though Profile is
 * — `/member/profile` edits your own record, and the rendered version somebody
 * else reads is a directory page.
 *
 * Here rather than in `routes/member/nav-items.ts` because `AppTopbar` mounts
 * the dropdown on every authenticated page, so these four are reachable from
 * the staff and band panels too. `nav-items.ts` imports this list back for
 * active-row resolution, so there is one source rather than two that drift.
 */

export type AccountMenuKey = 'profile' | 'account' | 'purchases' | 'membership';

export interface AccountMenuItem extends NavNode<AccountMenuKey> {
	label: string;
	/**
	 * Narrower than `NavNode`'s, which allows `''` for a row with no in-app
	 * destination. Every item here has one, and `svelte/no-navigation-without-resolve`
	 * rejects the union at the `<a href>` that renders it.
	 */
	href: ResolvedPathname;
}

export const ACCOUNT_MENU: AccountMenuItem[] = [
	{ key: 'profile', label: 'Profile', href: resolve('/member/profile') },
	{ key: 'account', label: 'Account', href: resolve('/member/account') },
	// A receipt list is billing history and belongs beside Membership, not among
	// the things you do in the space.
	{ key: 'purchases', label: 'Purchases', href: resolve('/member/purchases') },
	{ key: 'membership', label: 'Membership', href: resolve('/member/membership') }
];

/** Messages, the one chrome destination that is a place rather than a setting. */
export const MESSAGES_HREF = resolve('/member/messages');

export function activeAccountMenuKey(pathname: string): AccountMenuKey | null {
	return activeNavKey(ACCOUNT_MENU, pathname);
}
