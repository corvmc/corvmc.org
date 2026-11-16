import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type CommunityNavKey = 'users' | 'groups' | 'calendar' | 'moderation' | 'classifieds';

/** Members and what they post (#3112). */
export const community: StaffNavSection = {
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
		// The key stays `groups`, which starred rows store.
		{
			key: 'groups',
			capability: 'band.read',
			label: 'Bands',
			href: resolve('staff/bands')
		},
		// Every listing, with Productions, Venues and vendor applications as views
		// (#2766). A venue's own page stays under `/staff/venues` and lights this row.
		{
			key: 'calendar',
			capability: 'event.read',
			label: 'Events',
			href: resolve('staff/events'),
			also: [resolve('staff/venues')]
		},
		// Flags and Blocklist are its views, each with its own gate (#2393). Flag
		// records keep their addresses, which notifications link to.
		{
			key: 'moderation',
			capability: 'moderation.reviewFlags',
			alsoFor: ['user.ban'],
			label: 'Moderation',
			href: resolve('staff/moderation'),
			also: [resolve('staff/flags')]
		},
		{
			key: 'classifieds',
			capability: 'listing.review',
			surface: 'classifieds',
			label: 'Classifieds',
			href: resolve('staff/classifieds')
		}
	]
};
