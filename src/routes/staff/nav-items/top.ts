import { resolve } from '$app/paths';
import type { StaffNavItem } from './types';

export type TopNavKey = 'dashboard' | 'inbox';

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
