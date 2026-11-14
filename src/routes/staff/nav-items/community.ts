import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type CommunityNavKey =
	'users' | 'groups' | 'suggestions' | 'ballots' | 'moderation' | 'classifieds' | 'content';

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
};
