import type { ResolvedPathname } from '$app/types';
import { resolve } from '$app/paths';
import { activeNavKey, type NavNode } from './Nav/active-nav';

/**
 * The member-context destinations — the avatar dropdown, not a sidebar (#1244).
 *
 * Strictly self-context: identity, settings, receipts, subscription. Directory
 * is not here even though Profile is, because `/member/profile` edits your own
 * record. Here rather than in `nav-items.ts` because the dropdown mounts on
 * every panel; that file imports this one back, so the two cannot drift.
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
